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
const CRON_SCHEDULE_DAILY = process.env.CRON_SCHEDULE_DAILY || '0 10 * * *'; // Default to 10:00 AM
const CRON_SCHEDULE_WARNING = process.env.CRON_SCHEDULE_WARNING || '0 18 * * *'; // Default to 6:00 PM

// Reference to the metrics document for counters
const metricsDocRef = db.collection('metrics').doc('summary');

function getCurrentThaiTime() {
  return moment.tz('Asia/Bangkok');
}

function getTimestamp() {
  return getCurrentThaiTime().format('DD/MM/YYYY HH:mm:ss');
}

// ------------------------------------------------
// Functions for the minute-by-minute Flex Message cron job
// ------------------------------------------------

function createTaskFlexMessage(task) {
  const messageDate = moment(task.notificationTime.toDate()).tz('Asia/Bangkok');
  const dateDisplay = messageDate.isValid()
    ? messageDate.format('DD/MM/YYYY HH:mm น.')
    : 'ไม่ระบุเวลา';

  const liffUrl = "https://liff.line.me/2007809557-PQXApdR3";

  return {
    type: "flex",
    altText: `🔔 แจ้งเตือน: ${task.title}`,
    contents: {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "🔔 Notificationsss",
            weight: "bold",
            color: "#ffffff",
            size: "lg",
            align: "center"
          }
        ],
        backgroundColor: "#3b82f6",
        paddingAll: "20px"
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: task.title,
            weight: "bold",
            size: "xl",
            color: "#1f2937",
            wrap: true,
            margin: "none"
          },
          {
            type: "text",
            text: task.detail || "ไม่มีรายละเอียด",
            size: "md",
            color: "#6b7280",
            wrap: true,
            margin: "md"
          },
          {
            type: "separator",
            margin: "lg"
          },
          {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  {
                    type: "text",
                    text: "🕐",
                    size: "sm",
                    color: "#6b7280",
                    flex: 0
                  },
                  {
                    type: "text",
                    text: dateDisplay,
                    size: "sm",
                    color: "#6b7280",
                    flex: 1,
                    margin: "sm"
                  }
                ]
              },
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  {
                    type: "text",
                    text: "🔄",
                    size: "sm",
                    color: "#6b7280",
                    flex: 0
                  },
                  {
                    type: "text",
                    text: `Repeat: ${task.repeatType || 'Never'}`,
                    size: "sm",
                    color: "#6b7280",
                    flex: 1,
                    margin: "sm"
                  }
                ]
              }
            ],
            margin: "lg",
            spacing: "sm"
          }
        ],
        paddingAll: "20px"
      },
      footer: {
        type: "box",
        layout: "horizontal",
        contents: [
          {
            type: "button",
            style: "secondary",
            height: "sm",
            flex: 1,
            action: {
              type: "uri",
              label: "View Task",
              uri: liffUrl,
            },
            color: "#eeeeee"
          },
          {
            type: "button",
            style: "primary",
            height: "sm",
            flex: 1,
            action: {
              type: "postback",
              label: "Done",
              data: `complete_task_user_${task.userId}_task_${task.parentId}_notification_${task.id}`,
              displayText: "งานนี้เสร็จแล้ว ✅"
            },
            color: "#10b981"
          }
        ],
        spacing: "sm",
        paddingAll: "20px"
      }
    }
  };
}

async function sendFlexMessage(userId, message) {
  const timestamp = getTimestamp();
  console.log(`[${timestamp}] 📤 Attempting to send flex message to user: ${userId}`);
  try {
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_ACCESS_TOKEN}`
      },
      body: JSON.stringify({
        to: userId,
        messages: [message]
      })
    });
    if (response.ok) {
      const successTime = getTimestamp();
      console.log(`[${successTime}] ✅ Flex message sent successfully to ${userId}`);
      return true;
    } else {
      const errorText = await response.text();
      console.error(`[${timestamp}] ❌ Failed to send flex message:`, errorText);
      return false;
    }
  } catch (error) {
    console.error(`[${timestamp}] ❌ Error sending flex message:`, error);
    return false;
  }
}

async function checkNotifications() {
  const now = moment.tz('Asia/Bangkok');
  const fiveMinutesAgo = now.clone().subtract(5, 'minutes');
  console.log(`\n[${getTimestamp()}] ⏰ 🔄 CRON JOB TRIGGERED - Running scheduled notification check...`);
  console.log(`[${getTimestamp()}] 🔍 Looking for notifications due between ${fiveMinutesAgo.format()} and ${now.format()}`);

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
          const flexMessage = createTaskFlexMessage({
            ...parentTaskData,
            ...notificationData,
            id: notificationDoc.id,
            parentId: parentTaskDoc.id,
            userId: parentTaskData.userId,
          });
          messagesToSend.push({
            userId: parentTaskData.userId,
            message: flexMessage
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

    // Metric for intended sends
    if (messagesToSend.length > 0) {
      metricsDocRef.update({
        schedule_sent: admin.firestore.FieldValue.increment(messagesToSend.length)
      }).catch(error => console.error("Error updating schedule_sent metrics:", error));
    }

    // +++ MODIFIED: Count actual successful sends +++
    let successfulSends = 0;
    for (const messageObj of messagesToSend) {
        const success = await sendFlexMessage(messageObj.userId, messageObj.message);
        if (success) {
            successfulSends++;
        }
    }

    // +++ ADDED: Update actually_sent_noti metric +++
    if (successfulSends > 0) {
        metricsDocRef.update({
            actually_sent_noti: admin.firestore.FieldValue.increment(successfulSends)
        }).catch(error => console.error("Error updating actually_sent_noti metrics:", error));
    }

    console.log(`[${getTimestamp()}] ✅ All notifications processed. Successfully sent ${successfulSends}/${messagesToSend.length}.`);

  } catch (error) {
    console.error(`[${getTimestamp()}] ❌ Error in checkNotifications:`, error);
  }
}

// ------------------------------------------------
// Functions for the daily summary cron job
// ------------------------------------------------

function createDailySummaryTextMessage(tasks) {
  const today = moment().tz('Asia/Bangkok').format('DD/MM/YYYY');
  let message = `☀️ สรุปงานสำหรับวันนี้ (${today})\n\n`;
  tasks.forEach((task, index) => {
    const timeDisplay = moment(task.notificationTime).tz('Asia/Bangkok').format('HH:mm');
    message += `${index + 1}. ${task.title} เวลา ${timeDisplay}\n`;
  });
  message += `\nมีทั้งหมด ${tasks.length} งาน`;
  return message;
}

function createDailyWarningTextMessage(tasks) {
  const today = moment().tz('Asia/Bangkok').format('DD/MM/YYYY');
  let message = `🚨 สรุปงานที่ยังไม่เสร็จวันนี้ (${today})\n\n`; // Updated message for warning
  tasks.forEach((task, index) => {
    const timeDisplay = moment(task.notificationTime).tz('Asia/Bangkok').format('HH:mm');
    message += `${index + 1}. ${task.title} เวลา ${timeDisplay}\n`;
  });
  message += `\nมีทั้งหมด ${tasks.length} งาน`;
  return message;
}

function createNoTaskTextMessage() {
  return "🎉 สบายๆ เลย! คุณไม่มีงานที่ต้องทำในวันนี้ 😊\nใช้เวลาพักผ่อนได้เต็มที่เลยนะ!";
}

function createNoIncompleteTaskTextMessage() {
  return "✅ เยี่ยมมาก! คุณได้ทำภารกิจทั้งหมดในวันนี้เรียบร้อยแล้ว!";
}

async function sendLineTextMessage(userId, textMessage) {
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
      console.error(`[${timestamp}] ❌ Failed to send text message:`, errorText);
      return false;
    }
  } catch (error) {
    console.error(`[${timestamp}] ❌ Error sending text message:`, error);
    return false;
  }
}

async function sendDailySummaryNotifications() {
  const now = moment.tz('Asia/Bangkok');
  const startOfDay = now.clone().startOf('day');
  const endOfDay = now.clone().endOf('day');
  console.log(`\n[${getTimestamp()}] ☀️ Daily Summary CRON JOB TRIGGERED - Running...`);

  try {
    const notificationsRef = db.collectionGroup('notifications');
    const notificationsQuery = notificationsRef
      .where('status', '!=', 'Completed')
      .where('notificationTime', '>=', admin.firestore.Timestamp.fromDate(startOfDay.toDate()))
      .where('notificationTime', '<=', admin.firestore.Timestamp.fromDate(endOfDay.toDate()));

    const notificationsSnapshot = await notificationsQuery.get();

    if (notificationsSnapshot.empty) {
      const successfulSummariesWithoutTasks = await handleUsersWithNoTasks(new Set());
      // +++ ADDED: Update actually_sent_summary metric +++
      if (successfulSummariesWithoutTasks > 0) {
        metricsDocRef.update({
            actually_sent_summary: admin.firestore.FieldValue.increment(successfulSummariesWithoutTasks)
        }).catch(error => console.error("Error updating actually_sent_summary metrics:", error));
      }
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
    
    // +++ MODIFIED: Capture successful sends for users WITH tasks +++
    const messagePromises = Object.keys(userTasks).map(async (userId) => {
      const tasks = userTasks[userId].sort((a, b) => a.notificationTime - b.notificationTime);
      const summaryMessage = createDailySummaryTextMessage(tasks);
      return await sendLineTextMessage(userId, summaryMessage); // Return boolean result
    });
    const resultsWithTasks = await Promise.all(messagePromises);
    const successfulSummariesWithTasks = resultsWithTasks.filter(Boolean).length;

    // Metric for intended sends
    const summariesWithTasksSent = Object.keys(userTasks).length;
    if (summariesWithTasksSent > 0) {
      metricsDocRef.update({
        summary_sent: admin.firestore.FieldValue.increment(summariesWithTasksSent)
      }).catch(error => console.error("Error updating summary_sent metrics:", error));
    }
    
    // +++ MODIFIED: Get successful sends for users WITHOUT tasks +++
    const successfulSummariesWithoutTasks = await handleUsersWithNoTasks(processedUserIds);
    const summariesWithoutTasksIntended = successfulSummariesWithoutTasks; // Approximation for intended metric
    if (summariesWithoutTasksIntended > 0) {
        metricsDocRef.update({
            summary_sent: admin.firestore.FieldValue.increment(summariesWithoutTasksIntended)
        }).catch(error => console.error("Error updating summary_sent metrics:", error));
    }

    // +++ ADDED: Combine all successful sends and update the new metric +++
    const totalSuccessfulSummaries = successfulSummariesWithTasks + successfulSummariesWithoutTasks;
    if (totalSuccessfulSummaries > 0) {
        metricsDocRef.update({
            actually_sent_summary: admin.firestore.FieldValue.increment(totalSuccessfulSummaries)
        }).catch(error => console.error("Error updating actually_sent_summary metrics:", error));
    }

    console.log(`[${getTimestamp()}] ✅ Daily summary notification process completed. Total successful sends: ${totalSuccessfulSummaries}`);

  } catch (error) {
    console.error(`[${getTimestamp()}] ❌ Error in sendDailySummaryNotifications:`, error);
  }
}

// +++ MODIFIED: This function now returns the count of SUCCESSFUL messages sent +++
async function handleUsersWithNoTasks(usersWithTasks = new Set()) {
  console.log(`[${getTimestamp()}] 🔄 Checking for users with no tasks today...`);
  let successfulSends = 0;
  const usersRef = db.collection('users');
  const usersSnapshot = await usersRef.get();
  const noTaskMessage = createNoTaskTextMessage();
  for (const userDoc of usersSnapshot.docs) {
    const userId = userDoc.id;
    if (!usersWithTasks.has(userId)) {
      const userHasAnyNotificationsQuery = db.collection('tasks').where('userId', '==', userId).limit(1);
      const userHasAnyNotificationsSnapshot = await userHasAnyNotificationsQuery.get();
      if (!userHasAnyNotificationsSnapshot.empty) {
        console.log(`[${getTimestamp()}] 💌 Sending 'no tasks today' message to user: ${userId}`);
        const success = await sendLineTextMessage(userId, noTaskMessage);
        if (success) {
            successfulSends++;
        }
      }
    }
  }
  console.log(`[${getTimestamp()}] ✅ Finished checking for users with no tasks. Successful sends: ${successfulSends}`);
  return successfulSends;
}

async function sendDailyWarningNotifications() {
  const now = moment.tz('Asia/Bangkok');
  const startOfDay = now.clone().startOf('day');
  const endOfDay = now.clone().endOf('day');
  console.log(`\n[${getTimestamp()}] ☀️ Daily Warning CRON JOB TRIGGERED - Running...`);

  try {
    const notificationsRef = db.collectionGroup('notifications');
    const notificationsQuery = notificationsRef
      .where('status', '!=', 'Completed')
      .where('notificationTime', '>=', admin.firestore.Timestamp.fromDate(startOfDay.toDate()))
      .where('notificationTime', '<=', admin.firestore.Timestamp.fromDate(endOfDay.toDate()));

    const notificationsSnapshot = await notificationsQuery.get();

    if (notificationsSnapshot.empty) {
      const successfulWarningsWithoutTasks = await handleUsersWithNoWarning(new Set());
      // +++ ADDED: Update actually_sent_warning metric +++
      if (successfulWarningsWithoutTasks > 0) {
        metricsDocRef.update({
            actually_sent_warning: admin.firestore.FieldValue.increment(successfulWarningsWithoutTasks)
        }).catch(error => console.error("Error updating actually_sent_warning metrics:", error));
      }
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

    // +++ MODIFIED: Capture successful sends for users WITH incomplete tasks +++
    const messagePromises = Object.keys(userTasks).map(async (userId) => {
      const tasks = userTasks[userId].sort((a, b) => a.notificationTime - b.notificationTime);
      const summaryMessage = createDailyWarningTextMessage(tasks);
      return await sendLineTextMessage(userId, summaryMessage); // Return boolean result
    });
    const resultsWithWarnings = await Promise.all(messagePromises);
    const successfulWarningsWithTasks = resultsWithWarnings.filter(Boolean).length;
    
    // Metric for intended sends
    const warningsWithTasksSent = Object.keys(userTasks).length;
    if (warningsWithTasksSent > 0) {
      metricsDocRef.update({
        warning_sent: admin.firestore.FieldValue.increment(warningsWithTasksSent)
      }).catch(error => console.error("Error updating warning_sent metrics:", error));
    }

    // +++ MODIFIED: Get successful sends for users WITHOUT incomplete tasks +++
    const successfulWarningsWithoutTasks = await handleUsersWithNoWarning(processedUserIds);
    const warningsWithoutTasksIntended = successfulWarningsWithoutTasks; // Approximation for intended metric
    if (warningsWithoutTasksIntended > 0) {
        metricsDocRef.update({
            warning_sent: admin.firestore.FieldValue.increment(warningsWithoutTasksIntended)
        }).catch(error => console.error("Error updating warning_sent metrics:", error));
    }

    // +++ ADDED: Combine all successful sends and update the new metric +++
    const totalSuccessfulWarnings = successfulWarningsWithTasks + successfulWarningsWithoutTasks;
    if (totalSuccessfulWarnings > 0) {
        metricsDocRef.update({
            actually_sent_warning: admin.firestore.FieldValue.increment(totalSuccessfulWarnings)
        }).catch(error => console.error("Error updating actually_sent_warning metrics:", error));
    }

    console.log(`[${getTimestamp()}] ✅ Daily warning notification process completed. Total successful sends: ${totalSuccessfulWarnings}`);

  } catch (error) {
    console.error(`[${getTimestamp()}] ❌ Error in sendDailyWarningNotifications:`, error);
  }
}

// +++ MODIFIED: This function now returns the count of SUCCESSFUL messages sent +++
async function handleUsersWithNoWarning(usersWithTasks = new Set()) {
  console.log(`[${getTimestamp()}] 🔄 Checking for users with no incomplete today...`);
  let successfulSends = 0;
  const usersRef = db.collection('users');
  const usersSnapshot = await usersRef.get();
  const noIncompleteTaskMessage = createNoIncompleteTaskTextMessage();
  for (const userDoc of usersSnapshot.docs) {
    const userId = userDoc.id;
    if (!usersWithTasks.has(userId)) {
      const userHasAnyNotificationsQuery = db.collection('tasks').where('userId', '==', userId).limit(1);
      const userHasAnyNotificationsSnapshot = await userHasAnyNotificationsQuery.get();
      if (!userHasAnyNotificationsSnapshot.empty) {
        console.log(`[${getTimestamp()}] 💌 Sending 'no incomplete tasks today' message to user: ${userId}`);
        const success = await sendLineTextMessage(userId, noIncompleteTaskMessage);
        if (success) {
            successfulSends++;
        }
      }
    }
  }
  console.log(`[${getTimestamp()}] ✅ Finished checking for users with no warnings. Successful sends: ${successfulSends}`);
  return successfulSends;
}

// ------------------------------------------------
// Cron Job Scheduling
// ------------------------------------------------

console.log(`[${getTimestamp()}] ⏰ Starting notification scheduler...`);

cron.schedule('* * * * *', () => {
  checkNotifications();
});

cron.schedule(CRON_SCHEDULE_DAILY, () => {
  sendDailySummaryNotifications();
}, {
  timezone: "Asia/Bangkok"
});

cron.schedule(CRON_SCHEDULE_WARNING, () => {
  sendDailyWarningNotifications();
}, {
  timezone: "Asia/Bangkok"
});

console.log(`[${getTimestamp()}] 🚀 Performing initial minute check on startup...`);
checkNotifications();

const readyTime = getTimestamp();
console.log(`[${readyTime}] ✅ Notification scheduler is running!`);
console.log(`[${getTimestamp()}] 💡 Press Ctrl+C to stop the scheduler`);

process.on('SIGINT', () => {
  const shutdownTime = getTimestamp();
  console.log(`\n[${shutdownTime}] 🛑 Received shutdown signal - Gracefully shutting down notification scheduler...`);
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  const errorTime = getTimestamp();
  console.error(`[${errorTime}] ❌ Uncaught Exception:`, error);
});

process.on('unhandledRejection', (reason, promise) => {
  const errorTime = getTimestamp();
  console.error(`[${errorTime}] ❌ Unhandled Rejection at:`, promise, 'reason:', reason);
});