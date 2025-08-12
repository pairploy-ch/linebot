// const cron = require('node-cron');
// const admin = require('firebase-admin');
// const moment = require('moment-timezone');
// const { default: fetch } = require('node-fetch');

// require('dotenv').config();

// // Ensure Firebase is only initialized once
// if (!admin.apps.length) {
//   try {
//     const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG_JSON);
//     serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
//     admin.initializeApp({
//       credential: admin.credential.cert(serviceAccount),
//       projectId: serviceAccount.project_id,
//     });
//   } catch (error) {
//     console.error("Failed to initialize Firebase Admin SDK:", error);
//     process.exit(1);
//   }
// }

// const db = admin.firestore();
// const LINE_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

// function getCurrentThaiTime() {
//   return moment.tz('Asia/Bangkok');
// }

// function getTimestamp() {
//   return getCurrentThaiTime().format('DD/MM/YYYY HH:mm:ss');
// }

// function createTaskFlexMessage(task) {
//   const messageDate = moment(task.notificationTime.toDate()).tz('Asia/Bangkok');
//   const dateDisplay = messageDate.isValid()
//     ? messageDate.format('DD/MM/YYYY HH:mm น.')
//     : 'ไม่ระบุเวลา';

//   return {
//     type: "flex",
//     altText: `🔔 แจ้งเตือน: ${task.title}`,
//     contents: {
//       type: "bubble",
//       size: "kilo",
//       header: {
//         type: "box",
//         layout: "vertical",
//         contents: [
//           {
//             type: "text",
//             text: "🔔 Notification",
//             weight: "bold",
//             color: "#ffffff",
//             size: "lg",
//             align: "center"
//           }
//         ],
//         backgroundColor: "#3b82f6",
//         paddingAll: "20px"
//       },
//       body: {
//         type: "box",
//         layout: "vertical",
//         contents: [
//           {
//             type: "text",
//             text: task.title,
//             weight: "bold",
//             size: "xl",
//             color: "#1f2937",
//             wrap: true,
//             margin: "none"
//           },
//           {
//             type: "text",
//             text: task.detail || "ไม่มีรายละเอียด",
//             size: "md",
//             color: "#6b7280",
//             wrap: true,
//             margin: "md"
//           },
//           {
//             type: "separator",
//             margin: "lg"
//           },
//           {
//             type: "box",
//             layout: "vertical",
//             contents: [
//               {
//                 type: "box",
//                 layout: "horizontal",
//                 contents: [
//                   {
//                     type: "text",
//                     text: "🕐",
//                     size: "sm",
//                     color: "#6b7280",
//                     flex: 0
//                   },
//                   {
//                     type: "text",
//                     text: dateDisplay,
//                     size: "sm",
//                     color: "#6b7280",
//                     flex: 1,
//                     margin: "sm"
//                   }
//                 ]
//               },
//               {
//                 type: "box",
//                 layout: "horizontal",
//                 contents: [
//                   {
//                     type: "text",
//                     text: "🔄",
//                     size: "sm",
//                     color: "#6b7280",
//                     flex: 0
//                   },
//                   {
//                     type: "text",
//                     text: `Repeat: ${task.repeatType || 'Never'}`,
//                     size: "sm",
//                     color: "#6b7280",
//                     flex: 1,
//                     margin: "sm"
//                   }
//                 ]
//               }
//             ],
//             margin: "lg",
//             spacing: "sm"
//           }
//         ],
//         paddingAll: "20px"
//       },
//       footer: {
//         type: "box",
//         layout: "vertical",
//         contents: [
//           {
//             type: "button",
//             style: "primary",
//             height: "sm",
//             // The corrected data string now contains all necessary IDs
//             action: {
//               type: "postback",
//               label: "Done",
//               data: `complete_task_user_${task.userId}_task_${task.parentId}_notification_${task.id}`,
//               displayText: "งานนี้เสร็จแล้ว ✅"
//             },
//             color: "#10b981"
//           }
//         ],
//         spacing: "sm",
//         paddingAll: "20px"
//       }
//     }
//   };
// }


// async function sendLineMessage(userId, message) {
//   const timestamp = getTimestamp();
//   console.log(`[${timestamp}] 📤 Attempting to send flex message to user: ${userId}`);

//   try {
//     const response = await fetch('https://api.line.me/v2/bot/message/push', {
//       method: 'POST',
//       headers: {
//         'Content-Type': 'application/json',
//         'Authorization': `Bearer ${LINE_ACCESS_TOKEN}`
//       },
//       body: JSON.stringify({
//         to: userId,
//         messages: [message]
//       })
//     });

//     if (response.ok) {
//       const successTime = getTimestamp();
//       console.log(`[${successTime}] ✅ Flex message sent successfully to ${userId}`);
//       return true;
//     } else {
//       const errorText = await response.text();
//       console.error(`[${errorTime}] ❌ Failed to send flex message:`, errorText);
//       return false;

//     }
//   } catch (error) {
//     const errorTime = getTimestamp();
//     console.error(`[${errorTime}] ❌ Error sending flex message:`, error);
//     return false;
//   }
// }

// // from linebot/notification-scheduler.js

// // from linebot/notification-scheduler.js

// async function checkNotifications() {
//   const now = moment.tz('Asia/Bangkok');
//   const fiveMinutesAgo = now.clone().subtract(5, 'minutes');

//   console.log(`\n[${getTimestamp()}] ⏰ 🔄 CRON JOB TRIGGERED - Running scheduled notification check...`);
//   console.log(`[${getTimestamp()}] 🌍 Current UTC time: ${moment.utc().format('YYYY-MM-DD HH:mm:ss')} UTC`);
//   console.log(`[${getTimestamp()}] 🇹🇭 Current Bangkok time: ${now.format('YYYY-MM-DD HH:mm:ss')} (Asia/Bangkok)`);
//   console.log(`[${getTimestamp()}] 🔍 Looking for notifications due between ${fiveMinutesAgo.format('YYYY-MM-DD HH:mm:ss')} and ${now.format('YYYY-MM-DD HH:mm:ss')}`);

//   try {
//     const notificationsRef = db.collectionGroup('notifications');

//     // Use a collection group query to find notifications that are due
//     const notificationsQuery = notificationsRef
//       .where('notified', '==', false)
//       .where('notificationTime', '>=', admin.firestore.Timestamp.fromDate(fiveMinutesAgo.toDate()))
//       .where('notificationTime', '<=', admin.firestore.Timestamp.fromDate(now.toDate()));

//     const notificationsSnapshot = await notificationsQuery.get();

//     if (notificationsSnapshot.empty) {
//       console.log('No notifications found within the window.');
//       console.log(`[${getTimestamp()}] ✅ Notification check finished with no tasks found.`);
//       return;
//     }

//     console.log(`[${getTimestamp()}] 📋 Found ${notificationsSnapshot.size} notification(s) ready to send.`);

//     const batch = db.batch();
//     const messagesToSend = [];

//     for (const notificationDoc of notificationsSnapshot.docs) {
//       console.log(`[${getTimestamp()}] ➡️ Processing notification document ID: ${notificationDoc.id}`);
//       const notificationData = notificationDoc.data();
//       const parentTaskRef = notificationDoc.ref.parent.parent;
//       const parentTaskDoc = await parentTaskRef.get();

//       if (parentTaskDoc.exists) {
//         const parentTaskData = parentTaskDoc.data();

//         const notificationTimeMoment = moment(notificationData.notificationTime.toDate());
//         console.log(`[${getTimestamp()}] 🕒 Notification time from Firestore: ${notificationTimeMoment.format()} (This is a Moment.js object, assuming local time if not specified)`);
//         console.log(`[${getTimestamp()}] 🕒 Notification time in UTC: ${notificationTimeMoment.utc().format('YYYY-MM-DD HH:mm:ss')} UTC`);
//         console.log(`[${getTimestamp()}] 🕒 Notification time in Bangkok: ${notificationTimeMoment.tz('Asia/Bangkok').format('YYYY-MM-DD HH:mm:ss')} (Asia/Bangkok)`);

//         if (notificationTimeMoment.isSameOrBefore(now)) {
//           console.log(`[${getTimestamp()}] ✅ Notification is due. Preparing to send message.`);
//           // Add detailed logging for the data being used to build the message
//           console.log(`[${getTimestamp()}] 📋 Data for new message:`);
//           console.log(`[${getTimestamp()}]   - userId: ${parentTaskData.userId}`);
//           console.log(`[${getTimestamp()}]   - parentId: ${parentTaskDoc.id}`);
//           console.log(`[${getTimestamp()}]   - notificationId: ${notificationDoc.id}`);

//           const flexMessage = createTaskFlexMessage({
//             ...parentTaskData,
//             ...notificationData,
//             id: notificationDoc.id,
//             parentId: parentTaskDoc.id,
//             userId: parentTaskData.userId,
//           });

//           messagesToSend.push({
//             userId: parentTaskData.userId,
//             message: flexMessage
//           });

//           batch.update(notificationDoc.ref, {
//             notified: true,
//             status: 'Overdue',
//             sentAt: admin.firestore.FieldValue.serverTimestamp(),
//           });
//           console.log(`[${getTimestamp()}] 📝 Added batch update for notification ${notificationDoc.id} to mark it as notified.`);

//           if (parentTaskData.repeatType === 'Never' || notificationTimeMoment.isSame(moment(parentTaskData.endDate).tz('Asia/Bangkok'), 'day')) {
//             batch.update(parentTaskRef, { status: 'Overdue' });
//             console.log(`[${getTimestamp()}] 📝 Added batch update for parent task ${parentTaskDoc.id} to mark it as Overdue.`);
//           }
//         } else {
//             console.log(`[${getTimestamp()}] ⏳ Notification is not yet due. Skipping message.`);
//         }
//       }
//     }

//     console.log(`[${getTimestamp()}] 💾 Committing batch of ${messagesToSend.length} database updates.`);
//     await batch.commit();

//     console.log(`[${getTimestamp()}] 📤 Sending ${messagesToSend.length} message(s)...`);
//     for (const messageObj of messagesToSend) {
//       await sendLineMessage(messageObj.userId, messageObj.message);
//     }

//     console.log(`[${getTimestamp()}] ✅ All notifications processed and sent.`);

//   } catch (error) {
//     console.error(`[${getTimestamp()}] ❌ Error in checkNotifications:`, error);
//     console.error(`[${getTimestamp()}] ❌ Error stack:`, error.stack);
//   }
// }



// const startupTime = getTimestamp();
// console.log(`[${startupTime}] ⏰ Starting notification scheduler...`);
// console.log(`[${getTimestamp()}] 📅 Scheduler configured to check every minute`);

// cron.schedule('* * * * *', () => {
//   const cronTime = getTimestamp();
//   console.log(`\n[${cronTime}] ⏰ 🔄 CRON JOB TRIGGERED - Running scheduled notification check...`);
//   checkNotifications();
// });

// console.log(`[${getTimestamp()}] 🚀 Performing initial notification check...`);
// checkNotifications();

// const readyTime = getTimestamp();
// console.log(`[${readyTime}] ✅ Notification scheduler is running!`);
// console.log(`[${getTimestamp()}] 💡 Press Ctrl+C to stop the scheduler`);

// process.on('SIGINT', () => {
//   const shutdownTime = getTimestamp();
//   console.log(`\n[${shutdownTime}] 🛑 Received shutdown signal - Gracefully shutting down notification scheduler...`);
//   process.exit(0);
// });

// process.on('uncaughtException', (error) => {
//   const errorTime = getTimestamp();
//   console.error(`[${errorTime}] ❌ Uncaught Exception:`, error);
// });

// process.on('unhandledRejection', (reason, promise) => {
//   const errorTime = getTimestamp();
//   console.error(`[${errorTime}] ❌ Unhandled Rejection at:`, promise, 'reason:', reason);
// });

const cron = require('node-cron');
const admin = require('firebase-admin');
const moment = require('moment-timezone');
const { default: fetch } = require('node-fetch');
const { Timestamp } = admin.firestore;

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


function createTaskFlexMessage(task) {
  const messageDate = moment(task.notificationTime.toDate()).tz('Asia/Bangkok');
  const dateDisplay = messageDate.isValid()
    ? messageDate.format('DD/MM/YYYY HH:mm น.')
    : 'ไม่ระบุเวลา';

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
            text: "🔔 Notification",
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
                    text: "�",
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
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            height: "sm",
            // The corrected data string now contains all necessary IDs
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


async function sendLineMessage(userId, message) {
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
      console.error(`[${errorTime}] ❌ Failed to send flex message:`, errorText);
      return false;

    }
  } catch (error) {
    const errorTime = getTimestamp();
    console.error(`[${errorTime}] ❌ Error sending flex message:`, error);
    return false;
  }
}


// from linebot/notification-scheduler.js
// async function checkNotifications() { ... old code ...}

async function checkNotifications() {
  const now = moment.tz('Asia/Bangkok');
  const fiveMinutesAgo = now.clone().subtract(5, 'minutes');

  console.log(`\n[${getTimestamp()}] ⏰ 🔄 CRON JOB TRIGGERED - Running scheduled notification check...`);
  console.log(`[${getTimestamp()}] 🌍 Current UTC time: ${moment.utc().format('YYYY-MM-DD HH:mm:ss')} UTC`);
  console.log(`[${getTimestamp()}] 🇹🇭 Current Bangkok time: ${now.format('YYYY-MM-DD HH:mm:ss')} (Asia/Bangkok)`);
  console.log(`[${getTimestamp()}] 🔍 Looking for notifications due between ${fiveMinutesAgo.format('YYYY-MM-DD HH:mm:ss')} and ${now.format('YYYY-MM-DD HH:mm:ss')}`);

  try {
    const notificationsRef = db.collectionGroup('notifications');

    // Use a collection group query to find notifications that are due
    const notificationsQuery = notificationsRef
      .where('notified', '==', false)
      .where('notificationTime', '>=', Timestamp.fromDate(fiveMinutesAgo.toDate()))
      .where('notificationTime', '<=', Timestamp.fromDate(now.toDate()));

    const notificationsSnapshot = await notificationsQuery.get();

    if (notificationsSnapshot.empty) {
      console.log('No notifications found within the window.');
      console.log(`[${getTimestamp()}] ✅ Notification check finished with no tasks found.`);
      return;
    }

    console.log(`[${getTimestamp()}] 📋 Found ${notificationsSnapshot.size} notification(s) ready to send.`);

    const batch = db.batch();
    const messagesToSend = [];

    for (const notificationDoc of notificationsSnapshot.docs) {
      console.log(`[${getTimestamp()}] ➡️ Processing notification document ID: ${notificationDoc.id}`);
      const notificationData = notificationDoc.data();
      const parentTaskRef = notificationDoc.ref.parent.parent;
      const parentTaskDoc = await parentTaskRef.get();

      if (parentTaskDoc.exists) {
        const parentTaskData = parentTaskDoc.data();

        const notificationTimeMoment = moment(notificationData.notificationTime.toDate());
        console.log(`[${getTimestamp()}] 🕒 Notification time from Firestore: ${notificationTimeMoment.format()} (This is a Moment.js object, assuming local time if not specified)`);
        console.log(`[${getTimestamp()}] 🕒 Notification time in UTC: ${notificationTimeMoment.utc().format('YYYY-MM-DD HH:mm:ss')} UTC`);
        console.log(`[${getTimestamp()}] 🕒 Notification time in Bangkok: ${notificationTimeMoment.tz('Asia/Bangkok').format('YYYY-MM-DD HH:mm:ss')} (Asia/Bangkok)`);

        if (notificationTimeMoment.isSameOrBefore(now)) {
          console.log(`[${getTimestamp()}] ✅ Notification is due. Preparing to send message.`);
          // Add detailed logging for the data being used to build the message
          console.log(`[${getTimestamp()}] 📋 Data for new message:`);
          console.log(`[${getTimestamp()}]   - userId: ${parentTaskData.userId}`);
          console.log(`[${getTimestamp()}]   - parentId: ${parentTaskDoc.id}`);
          console.log(`[${getTimestamp()}]   - notificationId: ${notificationDoc.id}`);

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
            status: 'Overdue',
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log(`[${getTimestamp()}] 📝 Added batch update for notification ${notificationDoc.id} to mark it as notified.`);

          if (parentTaskData.repeatType === 'Never' || notificationTimeMoment.isSame(moment(parentTaskData.endDate).tz('Asia/Bangkok'), 'day')) {
            batch.update(parentTaskRef, { status: 'Overdue' });
            console.log(`[${getTimestamp()}] 📝 Added batch update for parent task ${parentTaskDoc.id} to mark it as Overdue.`);
          }
        } else {
          console.log(`[${getTimestamp()}] ⏳ Notification is not yet due. Skipping message.`);
        }
      }
    }

    console.log(`[${getTimestamp()}] 💾 Committing batch of ${messagesToSend.length} database updates.`);
    await batch.commit();

    console.log(`[${getTimestamp()}] 📤 Sending ${messagesToSend.length} message(s)...`);
    for (const messageObj of messagesToSend) {
      await sendLineMessage(messageObj.userId, messageObj.message);
    }

    console.log(`[${getTimestamp()}] ✅ All notifications processed and sent.`);

  } catch (error) {
    console.error(`[${getTimestamp()}] ❌ Error in checkNotifications:`, error);
    console.error(`[${getTimestamp()}] ❌ Error stack:`, error.stack);
  }
}

// FIX: New function to send a daily summary to all users.
async function checkDailySummary() {
  console.log(`\n[${getTimestamp()}] ⏰ 🔄 DAILY SUMMARY JOB TRIGGERED - Running scheduled summary check...`);
  try {
    const usersRef = db.collection('users');
    const usersSnapshot = await usersRef.get();

    if (usersSnapshot.empty) {
      console.log(`[${getTimestamp()}] ⚠️ No users found in the database. Exiting.`);
      return;
    }

    const todayStart = moment().tz('Asia/Bangkok').startOf('day');
    const todayEnd = moment().tz('Asia/Bangkok').endOf('day');

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      console.log(`[${getTimestamp()}] 🔎 Processing tasks for user: ${userId}`);

      const userTasksRef = db.collection('users').doc(userId).collection('tasks');
      const userTasksSnapshot = await userTasksRef.get();

      const userTasks = [];
      for (const taskDoc of userTasksSnapshot.docs) {
        const notificationsRef = taskDoc.ref.collection('notifications');
        const notificationsQuery = notificationsRef
          .where('notificationTime', '>=', Timestamp.fromDate(todayStart.toDate()))
          .where('notificationTime', '<=', Timestamp.fromDate(todayEnd.toDate()))
          .where('status', '==', 'Upcoming');

        const notificationsSnapshot = await notificationsQuery.get();

        for (const notiDoc of notificationsSnapshot.docs) {
          const notiData = notiDoc.data();
          userTasks.push({
            title: taskDoc.data().title,
            notificationTime: notiData.notificationTime
          });
        }
      }

      let summaryText;
      if (userTasks.length > 0) {
        const tasksString = userTasks.map(task =>
          `• ${task.title} at ${moment(task.notificationTime.toDate()).tz("Asia/Bangkok").format("HH:mm")}`
        ).join('\n');
        summaryText = `🗓️ สรุปงานของคุณสำหรับวันนี้:\n\n${tasksString}`;
      } else {
        summaryText = `🎉 คุณไม่มีงานที่ต้องทำในวันนี้!`;
      }

      await sendLineMessage(userId, [{
        type: "text",
        text: summaryText
      }]);
      console.log(`[${getTimestamp()}] ✅ Summary sent to user ${userId}`);
    }

    console.log(`[${getTimestamp()}] 🎉 Daily summary process completed.`);
    return;
  } catch (error) {
    console.error(`[${getTimestamp()}] ❌ Error in dailyTaskSummary:`, error);
    return;
  }
}

// New Cron Job for daily summaries
cron.schedule('14 19 * * *', () => {
  const cronTime = getTimestamp();
  console.log(`\n[${cronTime}] ⏰ 🔄 CRON JOB TRIGGERED - Running daily summary check...`);
  checkDailySummary();
}, {
  timezone: "Asia/Bangkok"
});

const startupTime = getTimestamp();
console.log(`[${startupTime}] ⏰ Starting notification scheduler...`);
console.log(`[${getTimestamp()}] 📅 Scheduler configured to check every minute`);

cron.schedule('* * * * *', () => {
  const cronTime = getTimestamp();
  console.log(`\n[${cronTime}] ⏰ 🔄 CRON JOB TRIGGERED - Running scheduled notification check...`);
  checkNotifications();
}, {
  timezone: "Asia/Bangkok"
});

console.log(`[${getTimestamp()}] 🚀 Performing initial notification check...`);
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