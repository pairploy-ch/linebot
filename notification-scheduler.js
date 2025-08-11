// const cron = require('node-cron');
// const admin = require('firebase-admin');
// const path = require('path');
// const moment = require('moment-timezone');

// require('dotenv').config();

// const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG_JSON);
// serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');

// if (!admin.apps.length) {
//   admin.initializeApp({
//     credential: admin.credential.cert(serviceAccount),
//     projectId: serviceAccount.project_id,
//   });
// }

// const db = admin.firestore();
// const LINE_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;


// function getCurrentThaiTime() {
//   const thaiNow = moment.tz('Asia/Bangkok');

//   console.log(`[DEBUG] Thai now: ${thaiNow.format('YYYY-MM-DD HH:mm:ss')} (Asia/Bangkok)`);
//   console.log(`[DEBUG] UTC equivalent: ${thaiNow.clone().utc().format('YYYY-MM-DD HH:mm:ss')} UTC`);

//   return thaiNow;
// }

// function getTimestamp() {
//   const thaiTime = getCurrentThaiTime();
//   return thaiTime.format('DD/MM/YYYY HH:mm:ss');
// }

// function calculateNextDate(currentDate, repeatType) {

//   const currentMoment = moment.tz(currentDate, 'Asia/Bangkok');

//   switch (repeatType.toLowerCase()) {
//     case 'daily':
//       currentMoment.add(1, 'day');
//       break;
//     case 'weekly':
//       currentMoment.add(1, 'week');
//       break;
//     case 'monthly':
//       currentMoment.add(1, 'month');
//       break;
//     default:
//       return null;
//   }

//   return currentMoment.toDate();
// }

// function formatDateForFirestore(date) {

//   const thaiMoment = moment.tz(date, 'Asia/Bangkok');
//   return admin.firestore.Timestamp.fromDate(thaiMoment.toDate());
// }

// function parseFirebaseDate(dateValue) {
//   try {
//     if (!dateValue) {
//       return null;
//     }

//     console.log(`[DEBUG] Parsing date: "${dateValue}" (type: ${typeof dateValue})`);


//     if (dateValue.toDate && typeof dateValue.toDate === 'function') {
//       const jsDate = dateValue.toDate();

//       const thaiMoment = moment.tz(jsDate, 'Asia/Bangkok');
//       console.log(`[DEBUG] Firestore timestamp -> Thai: ${thaiMoment.format('YYYY-MM-DD HH:mm:ss')} (Asia/Bangkok)`);
//       return thaiMoment;
//     }


//     let dateStr = dateValue.toString();

//     if (dateStr.includes(' at ') && dateStr.includes('UTC+7')) {
//       const parts = dateStr.split(' at ');
//       const datePart = parts[0];
//       const timePart = parts[1].replace(' UTC+7', '');

//       console.log(`[DEBUG] Parsing Thai format: "${datePart} ${timePart}"`);


//       const parsedMoment = moment.tz(`${datePart} ${timePart}`, 'MMMM D, YYYY h:mm:ss A', 'Asia/Bangkok');

//       if (parsedMoment.isValid()) {
//         console.log(`[DEBUG] Parsed Thai time: ${parsedMoment.format('YYYY-MM-DD HH:mm:ss')} (Asia/Bangkok)`);
//         return parsedMoment;
//       }
//     }


//     const parsedMoment = moment.tz(dateStr, 'Asia/Bangkok');
//     if (parsedMoment.isValid()) {
//       console.log(`[DEBUG] Parsed as Thai: ${parsedMoment.format('YYYY-MM-DD HH:mm:ss')} (Asia/Bangkok)`);
//       return parsedMoment;
//     }

//     return null;
//   } catch (error) {
//     console.log(`[${getTimestamp()}] ❌ Error parsing date:`, error);
//     return null;
//   }
// }

// function createTaskFlexMessage(task) {
//   const messageDate = task.parsedMoment || getCurrentThaiTime();
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
//                     text: `Repeat: ${task.repeat || 'Never'}`,
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
//             action: {
//               type: "postback",
//               label: "Done",
//               data: `complete_task_${task.id}`,
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
//     const fetch = (await import('node-fetch')).default;

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
//       const errorTime = getTimestamp();
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

// // async function checkNotifications() {
// //   const startTime = getTimestamp();
// //   console.log(`[${startTime}] 🔍 Starting notification check process...`);

// //   try {
// //     const now = getCurrentThaiTime();
// //     console.log(`[${getTimestamp()}] 📊 Current time check:`);
// //     console.log(`[${getTimestamp()}]    📍 Thai time: ${now.format('DD/MM/YYYY HH:mm:ss')} (Asia/Bangkok)`);
// //     console.log(`[${getTimestamp()}]    📍 Unix timestamp: ${now.unix()}`);
// //     console.log(`[${getTimestamp()}]    📍 UTC equivalent: ${now.clone().utc().format('DD/MM/YYYY HH:mm:ss')} UTC`);

// //     const notificationsRef = db.collection('tasks');
// //     console.log(`[${getTimestamp()}] 🔗 Connected to Firestore collection: tasks`);

// //     const queryStartTime = Date.now();
// //     console.log(`[${getTimestamp()}] 🔎 Querying upcoming notifications...`);

// //     const snapshot = await notificationsRef
// //       .where('status', '==', 'Upcoming')
// //       .get();

// //     const queryEndTime = Date.now();
// //     const queryDuration = queryEndTime - queryStartTime;
// //     console.log(`[${getTimestamp()}] 📊 Query completed in ${queryDuration}ms`);

// //     if (snapshot.empty) {
// //       console.log(`[${getTimestamp()}] 📭 No upcoming notifications found`);
// //       return;
// //     }

// //     console.log(`[${getTimestamp()}] 📋 Found ${snapshot.size} upcoming notification(s)`);

// //     const filterStartTime = getTimestamp();
// //     console.log(`[${filterStartTime}] 🔄 Filtering notifications by date...`);

// //     const notifications = [];
// //     snapshot.forEach(doc => {
// //       const data = doc.data();

// //       console.log(`[${getTimestamp()}] 🔍 Raw date value: "${data.date}" (type: ${typeof data.date})`);

// //       const parsedMoment = parseFirebaseDate(data.date);

// //       if (parsedMoment && parsedMoment.isValid()) {
// //         const dateString = parsedMoment.format('DD/MM/YYYY HH:mm:ss');
// //         console.log(`[${getTimestamp()}] ✅ Parsed date successfully: ${dateString} (Asia/Bangkok)`);

// //         console.log(`[${getTimestamp()}] 📅 Checking notification: "${data.title}" scheduled for ${dateString}`);
// //         console.log(`[${getTimestamp()}] ⏰ Comparing times (both in Asia/Bangkok timezone):`);
// //         console.log(`[${getTimestamp()}]    📍 Current: ${now.format('DD/MM/YYYY HH:mm:ss')}`);
// //         console.log(`[${getTimestamp()}]    🎯 Target:  ${parsedMoment.format('DD/MM/YYYY HH:mm:ss')}`);


// //         const diffSeconds = parsedMoment.diff(now, 'seconds');
// //         console.log(`[${getTimestamp()}]    ⏱️  Difference: ${diffSeconds} seconds`);


// //         if (now.isSameOrAfter(parsedMoment) || Math.abs(diffSeconds) <= 60) {
// //           console.log(`[${getTimestamp()}] ✅ Notification "${data.title}" is ready to send!`);
// //           notifications.push({
// //             id: doc.id,
// //             ref: doc.ref,
// //             ...data,
// //             parsedMoment: parsedMoment
// //           });
// //         } else {
// //           const minutesRemaining = Math.ceil(diffSeconds / 60);
// //           console.log(`[${getTimestamp()}] ⏳ Notification "${data.title}" not yet ready`);
// //           console.log(`[${getTimestamp()}]    ⏰ Time remaining: ${minutesRemaining} minutes (${diffSeconds} seconds)`);
// //         }
// //       } else {
// //         console.log(`[${getTimestamp()}] ⚠️  Skipping notification "${data.title}" due to invalid date: ${data.date}`);
// //       }
// //     });

// //     const filterEndTime = getTimestamp();
// //     console.log(`[${filterEndTime}] ✅ Filtering completed`);

// //     if (notifications.length === 0) {
// //       console.log(`[${getTimestamp()}] 📭 No notifications ready to send at this time`);
// //       return;
// //     }

// //     console.log(`[${getTimestamp()}] 📬 Found ${notifications.length} notification(s) ready to send`);

// //     for (let i = 0; i < notifications.length; i++) {
// //       const notification = notifications[i];
// //       const processStartTime = getTimestamp();
// //       console.log(`[${processStartTime}] 📤 Processing notification ${i + 1}/${notifications.length}: "${notification.title}"`);

// //       const flexMessage = createTaskFlexMessage(notification);
// //       console.log(`[${getTimestamp()}] 💬 Flex message created for notification: "${notification.title}"`);

// //       const sendStartTime = getTimestamp();
// //       console.log(`[${sendStartTime}] 🚀 Sending flex message to user: ${notification.userId}`);

// //       const success = await sendLineMessage(notification.userId, flexMessage);

// //       if (success) {
// //         const updateStartTime = getTimestamp();
// //         console.log(`[${updateStartTime}] 📝 Processing repeat logic for notification...`);

// //         const repeatType = notification.repeat || 'Never';
// //         console.log(`[${getTimestamp()}] 🔄 Repeat type: ${repeatType}`);

// //         if (repeatType.toLowerCase() === 'never') {
// //           console.log(`[${getTimestamp()}] ⏰ Task doesn't repeat - updating status to 'Overdue'`);

// //           await notification.ref.update({
// //             status: 'Overdue', 
// //             sentAt: admin.firestore.FieldValue.serverTimestamp(),
// //             notificationSent: true
// //           });

// //           console.log(`[${getTimestamp()}] ✅ Task "${notification.title}" status updated to Overdue`);

// //         } else {
// //           const nextDate = calculateNextDate(notification.parsedMoment.toDate(), repeatType);

// //           if (nextDate) {
// //             const nextTimestamp = formatDateForFirestore(nextDate);
// //             console.log(`[${getTimestamp()}] 📅 Next occurrence calculated: ${moment.tz(nextDate, 'Asia/Bangkok').format('DD/MM/YYYY HH:mm:ss')} (Asia/Bangkok)`);

// //             await notification.ref.update({
// //               date: nextTimestamp, // ใช้ Firestore Timestamp
// //               status: 'Upcoming',
// //               lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
// //               notificationSent: true,
// //               repeatCount: admin.firestore.FieldValue.increment(1),
// //               updatedAt: admin.firestore.FieldValue.serverTimestamp()
// //             });

// //             console.log(`[${getTimestamp()}] ✅ Task "${notification.title}" rescheduled for next ${repeatType.toLowerCase()} occurrence`);
// //           } else {
// //             console.log(`[${getTimestamp()}] ⚠️  Unable to calculate next date for repeat type: ${repeatType}`);

// //             await notification.ref.update({
// //               status: 'Overdue', 
// //               sentAt: admin.firestore.FieldValue.serverTimestamp(),
// //               notificationSent: true,
// //               error: 'Unable to calculate next repeat date'
// //             });

// //             console.log(`[${getTimestamp()}] ⚠️  Task "${notification.title}" marked as Overdue due to repeat calculation error`);
// //           }
// //         }

// //         const updateEndTime = getTimestamp();
// //         console.log(`[${updateEndTime}] ✅ Notification "${notification.title}" processed successfully`);
// //       } else {
// //         console.log(`[${getTimestamp()}] ❌ Failed to process notification "${notification.title}"`);
// //       }

// //       const processEndTime = getTimestamp();
// //       console.log(`[${processEndTime}] 🏁 Completed processing notification ${i + 1}/${notifications.length}`);
// //     }

// //     const endTime = getTimestamp();
// //     console.log(`[${endTime}] 🎉 All notifications processed successfully`);

// //   } catch (error) {
// //     const errorTime = getTimestamp();
// //     console.error(`[${errorTime}] ❌ Error in checkNotifications:`, error);
// //   }
// // }

// // This is a conceptual replacement for the checkNotifications function in notification-scheduler.js
// async function checkNotifications() {
//   const now = moment.tz('Asia/Bangkok');
//   const fiveMinutesFromNow = now.clone().add(5, 'minutes');

//   try {
//     // 1. Get all parent tasks that are not yet complete
//     const tasksQuery = db.collection('tasks').where('status', '!=', 'Completed');
//     const tasksSnapshot = await tasksQuery.get();

//     if (tasksSnapshot.empty) {
//       console.log('No active tasks found.');
//       return;
//     }

//     for (const taskDoc of tasksSnapshot.docs) {
//       const taskData = taskDoc.data();
//       const taskNotificationsRef = taskDoc.ref.collection('notifications');

//       // 2. Query for notifications within the subcollection that are due now
//       const notificationsQuery = taskNotificationsRef
//         .where('notified', '==', false)
//         .where('notificationTime', '<=', Timestamp.fromDate(fiveMinutesFromNow.toDate()));

//       const notificationsSnapshot = await notificationsQuery.get();

//       if (notificationsSnapshot.empty) {
//         continue;
//       }

//       console.log(`Found ${notificationsSnapshot.size} notification(s) for task: ${taskData.title}`);

//       for (const notificationDoc of notificationsSnapshot.docs) {
//         const notificationData = notificationDoc.data();

//         // Check if the notification is actually in the future, if so, skip it.
//         const notificationTimeMoment = moment(notificationData.notificationTime.toDate()).tz('Asia/Bangkok');
//         if (notificationTimeMoment.isAfter(now)) {
//           continue;
//         }

//         // 3. Send the notification message
//         const message = createTaskFlexMessage({
//           ...taskData,
//           ...notificationData,
//           id: notificationDoc.id, // Use notification ID for postback
//         });

//         const success = await sendLineMessage(taskData.userId, message);

//         if (success) {
//           // 4. Update the individual notification's status
//           await notificationDoc.ref.update({
//             notified: true,
//             status: 'Overdue',
//           });

//           // 5. Check if this was the last notification and update the main task status
//           if (taskData.repeatType === 'Never') {
//             await taskDoc.ref.update({ status: 'Overdue' });
//           } else if (notificationTimeMoment.isSame(moment(taskData.endDate).tz('Asia/Bangkok'), 'day')) {
//             await taskDoc.ref.update({ status: 'Overdue' });
//           }
//         }
//       }
//     }
//   } catch (error) {
//     console.error('Error in checkNotifications:', error);
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
// 555


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

// from linebot/notification-scheduler.js

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
      .where('notificationTime', '>=', admin.firestore.Timestamp.fromDate(fiveMinutesAgo.toDate()))
      .where('notificationTime', '<=', admin.firestore.Timestamp.fromDate(now.toDate()));

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



const startupTime = getTimestamp();
console.log(`[${startupTime}] ⏰ Starting notification scheduler...`);
console.log(`[${getTimestamp()}] 📅 Scheduler configured to check every minute`);

cron.schedule('* * * * *', () => {
  const cronTime = getTimestamp();
  console.log(`\n[${cronTime}] ⏰ 🔄 CRON JOB TRIGGERED - Running scheduled notification check...`);
  checkNotifications();
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