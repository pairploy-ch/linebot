const cron = require('node-cron');
const admin = require('firebase-admin');
const moment = require('moment-timezone');
const { default: fetch } = require('node-fetch');

require('dotenv').config();

// Ensure Firebase is only initialized once
if (!admin.apps.length) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG_JSON);
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: serviceAccount.project_id,
        });
    } catch (error) {
        console.error("Failed to initialize Firebase Admin SDK:", error);
        process.exit(1);
    }
}

const db = admin.firestore();
const LINE_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

function getCurrentThaiTime() {
    return moment.tz('Asia/Bangkok');
}

function getTimestamp() {
    return getCurrentThaiTime().format('DD/MM/YYYY HH:mm:ss');
}

/**
 * Creates a simple text message for a single task notification.
 * @param {object} task - The task object.
 * @returns {string} A formatted string for the notification.
 */
function createTaskTextMessage(task) {
    const messageDate = moment(task.notificationTime.toDate()).tz('Asia/Bangkok');
    const dateDisplay = messageDate.isValid()
        ? messageDate.format('DD/MM/YYYY HH:mm น.')
        : 'ไม่ระบุเวลา';

    let message = `🔔 แจ้งเตือน\n\n`;
    message += `หัวข้อ: ${task.title}\n`;
    if (task.detail) {
        message += `รายละเอียด: ${task.detail}\n`;
    }
    message += `เวลา: ${dateDisplay}`;

    return message;
}

/**
 * Creates a simple text message for the daily summary of tasks.
 * @param {Array<object>} tasks - An array of task objects for the day.
 * @returns {string} A formatted multi-line string summarizing the tasks.
 */
function createDailySummaryTextMessage(tasks) {
    const today = moment().tz('Asia/Bangkok').format('DD/MM/YYYY');
    let message = `☀️ สรุปงานสำหรับวันนี้ (${today})\n\n`;

    tasks.forEach(task => {
        const timeDisplay = moment(task.notificationTime).tz('Asia/Bangkok').format('HH:mm น.');
        message += `• ${timeDisplay} - ${task.title}\n`;
    });

    message += `\nมีทั้งหมด ${tasks.length} งาน`;
    return message;
}

/**
 * Creates a simple text message for when a user has no tasks.
 * @returns {string} A friendly message.
 */
function createNoTaskTextMessage() {
    return "🎉 สบายๆ เลย! คุณไม่มีงานที่ต้องทำในวันนี้ 😊\nใช้เวลาพักผ่อนได้เต็มที่เลยนะ!";
}


async function sendLineMessage(userId, textMessage) {
    const timestamp = getTimestamp();
    console.log(`[${timestamp}] 📤 Attempting to send text message to user: ${userId}`);

    try {
        const response = await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${LINE_ACCESS_TOKEN}`
            },
            body: JSON.stringify({
                to: userId,
                messages: [{
                    type: 'text',
                    text: textMessage
                }]
            })
        });

        if (response.ok) {
            const successTime = getTimestamp();
            console.log(`[${successTime}] ✅ Text message sent successfully to ${userId}`);
            return true;
        } else {
            const errorText = await response.text();
            const errorTime = getTimestamp(); // Define errorTime here
            console.error(`[${errorTime}] ❌ Failed to send text message:`, errorText);
            return false;
        }
    } catch (error) {
        const errorTime = getTimestamp();
        console.error(`[${errorTime}] ❌ Error sending text message:`, error);
        return false;
    }
}

async function checkNotifications() {
    const now = moment.tz('Asia/Bangkok');
    const fiveMinutesAgo = now.clone().subtract(5, 'minutes');

    console.log(`\n[${getTimestamp()}] ⏰ 🔄 CRON JOB TRIGGERED - Running scheduled notification check...`);
    console.log(`[${getTimestamp()}] 🔍 Looking for notifications due between ${fiveMinutesAgo.format('HH:mm:ss')} and ${now.format('HH:mm:ss')}`);

    try {
        const notificationsRef = db.collectionGroup('notifications');
        const notificationsQuery = notificationsRef
            .where('notified', '==', false)
            .where('notificationTime', '>=', admin.firestore.Timestamp.fromDate(fiveMinutesAgo.toDate()))
            .where('notificationTime', '<=', admin.firestore.Timestamp.fromDate(now.toDate()));

        const notificationsSnapshot = await notificationsQuery.get();

        if (notificationsSnapshot.empty) {
            console.log('No notifications found within the window.');
            return;
        }

        console.log(`[${getTimestamp()}] 📋 Found ${notificationsSnapshot.size} notification(s) ready to send.`);

        const batch = db.batch();
        const messagesToSend = [];

        for (const notificationDoc of notificationsSnapshot.docs) {
            const notificationData = notificationDoc.data();
            const parentTaskRef = notificationDoc.ref.parent.parent;
            const parentTaskDoc = await parentTaskRef.get();

            if (parentTaskDoc.exists) {
                const parentTaskData = parentTaskDoc.data();
                const notificationTimeMoment = moment(notificationData.notificationTime.toDate());

                if (notificationTimeMoment.isSameOrBefore(now)) {
                    // *** CHANGED TO USE TEXT MESSAGE ***
                    const textMessage = createTaskTextMessage({
                        ...parentTaskData,
                        ...notificationData,
                    });

                    messagesToSend.push({
                        userId: parentTaskData.userId,
                        message: textMessage
                    });

                    batch.update(notificationDoc.ref, {
                        notified: true,
                        status: 'Incomplete',
                        sentAt: admin.firestore.FieldValue.serverTimestamp(),
                    });

                    if (parentTaskData.repeatType === 'Never' || notificationTimeMoment.isSame(moment(parentTaskData.endDate).tz('Asia/Bangkok'), 'day')) {
                        batch.update(parentTaskRef, { status: 'Incomplete' });
                    }
                }
            }
        }

        await batch.commit();

        for (const messageObj of messagesToSend) {
            await sendLineMessage(messageObj.userId, messageObj.message);
        }

        console.log(`[${getTimestamp()}] ✅ All notifications processed and sent.`);

    } catch (error) {
        console.error(`[${getTimestamp()}] ❌ Error in checkNotifications:`, error);
    }
}

async function sendDailySummaryNotifications() {
    const now = moment.tz('Asia/Bangkok');
    const startOfDay = now.clone().startOf('day');
    const endOfDay = now.clone().endOf('day');

    console.log(`\n[${getTimestamp()}] ☀️ Daily Summary CRON JOB TRIGGERED - Running...`);
    console.log(`[${getTimestamp()}] 🔍 Looking for tasks for today, ${now.format('DD/MM/YYYY')}`);

    try {
        const notificationsRef = db.collectionGroup('notifications');
        const notificationsQuery = notificationsRef
            .where('notificationTime', '>=', admin.firestore.Timestamp.fromDate(startOfDay.toDate()))
            .where('notificationTime', '<=', admin.firestore.Timestamp.fromDate(endOfDay.toDate()));

        const notificationsSnapshot = await notificationsQuery.get();

        if (notificationsSnapshot.empty) {
            console.log(`[${getTimestamp()}] 📋 No notifications found for today.`);
            await handleUsersWithNoTasks(new Set());
            console.log(`[${getTimestamp()}] ✅ Daily summary check finished.`);
            return;
        }

        const userTasks = {};
        const processedUserIds = new Set();

        for (const notificationDoc of notificationsSnapshot.docs) {
            const notificationData = notificationDoc.data();
            const parentTaskRef = notificationDoc.ref.parent.parent;
            const parentTaskDoc = await parentTaskRef.get();

            if (parentTaskDoc.exists) {
                const parentTaskData = parentTaskDoc.data();
                const userId = parentTaskData.userId;

                if (!userTasks[userId]) {
                    userTasks[userId] = [];
                }

                userTasks[userId].push({
                    title: parentTaskData.title,
                    notificationTime: notificationData.notificationTime.toDate(),
                });
                processedUserIds.add(userId);
            }
        }

        const messagePromises = Object.keys(userTasks).map(async (userId) => {
            const tasks = userTasks[userId].sort((a, b) => a.notificationTime - b.notificationTime);
            // *** CHANGED TO USE TEXT MESSAGE ***
            const summaryMessage = createDailySummaryTextMessage(tasks);
            await sendLineMessage(userId, summaryMessage);
        });

        await Promise.all(messagePromises);
        console.log(`[${getTimestamp()}] ✅ Sent daily summaries to ${Object.keys(userTasks).length} user(s).`);

        await handleUsersWithNoTasks(processedUserIds);
        console.log(`[${getTimestamp()}] ✅ Daily summary notification process completed.`);

    } catch (error) {
        console.error(`[${getTimestamp()}] ❌ Error in sendDailySummaryNotifications:`, error);
    }
}

async function handleUsersWithNoTasks(usersWithTasks = new Set()) {
    console.log(`[${getTimestamp()}] 🔄 Checking for users with no tasks today...`);
    const usersRef = db.collection('users');
    const usersSnapshot = await usersRef.get();

    // *** CHANGED TO USE TEXT MESSAGE ***
    const noTaskMessage = createNoTaskTextMessage();

    for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id;
        if (!usersWithTasks.has(userId)) {
            const userHasAnyNotificationsQuery = db.collection('tasks').where('userId', '==', userId).limit(1);
            const userHasAnyNotificationsSnapshot = await userHasAnyNotificationsQuery.get();

            if (!userHasAnyNotificationsSnapshot.empty) {
                console.log(`[${getTimestamp()}] 💌 Sending 'no tasks today' message to user: ${userId}`);
                await sendLineMessage(userId, noTaskMessage);
            }
        }
    }
    console.log(`[${getTimestamp()}] ✅ Finished checking for users with no tasks.`);
}

// --- Cron Job Scheduling ---

console.log(`[${getTimestamp()}] ⏰ Starting notification scheduler...`);

// Runs every minute for due notifications
cron.schedule('* * * * *', () => {
    const cronTime = getTimestamp();
    console.log(`\n[${cronTime}] ⏰ CRON (Per Minute) - Running check...`);
    checkNotifications();
});

// Runs daily at 8:00 AM for the summary
cron.schedule('0 8 * * *', () => {
    const cronTime = getTimestamp();
    console.log(`\n[${cronTime}] ☀️ CRON (Daily 8am) - Running summary check...`);
    sendDailySummaryNotifications();
}, {
    timezone: "Asia/Bangkok"
});


// --- Initial runs on startup ---
console.log(`[${getTimestamp()}] 🚀 Performing initial checks on startup...`);
checkNotifications();
sendDailySummaryNotifications();


const readyTime = getTimestamp();
console.log(`[${readyTime}] ✅ Notification scheduler is running!`);

process.on('SIGINT', () => {
    console.log(`\n[${getTimestamp()}] 🛑 Gracefully shutting down...`);
    process.exit(0);
});