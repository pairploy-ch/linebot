const cron = require('node-cron');
const admin = require('firebase-admin');
const path = require('path');
const moment = require('moment-timezone');

require('dotenv').config();

const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG_JSON);
serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });
}

const db = admin.firestore();
const LINE_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;


function getCurrentThaiTime() {
  return moment().tz('Asia/Bangkok');
}

function getTimestamp() {
  return getCurrentThaiTime().format('DD/MM/YYYY HH:mm:ss');
}

function calculateNextDate(currentDate, repeatType) {
  const nextMoment = moment(currentDate).tz('Asia/Bangkok');
  
  switch (repeatType.toLowerCase()) {
    case 'daily':
      nextMoment.add(1, 'day');
      break;
    case 'weekly':
      nextMoment.add(1, 'week');
      break;
    case 'monthly':
      nextMoment.add(1, 'month');
      break;
    default:
      return null;
  }
  
  return nextMoment.toDate();
}

function formatDateForFirestore(date) {
  const momentDate = moment(date).tz('Asia/Bangkok');
  return momentDate.format('MMMM D, YYYY [at] h:mm:ss A [UTC+7]');
}


function parseFirebaseDate(dateValue) {
  try {
    if (!dateValue) {
      return null;
    }


    if (dateValue.toDate && typeof dateValue.toDate === 'function') {
    
      return moment(dateValue.toDate()).tz('Asia/Bangkok');
    }

  
    let dateStr = dateValue.toString();
    
 
    if (dateStr.includes(' at ') && dateStr.includes('UTC+7')) {
      const parts = dateStr.split(' at ');
      const datePart = parts[0];
      const timePart = parts[1].replace(' UTC+7', '');
      
 
      const momentDate = moment.tz(`${datePart} ${timePart}`, 'MMMM D, YYYY h:mm:ss A', 'Asia/Bangkok');
      
      if (momentDate.isValid()) {
        console.log(`[${getTimestamp()}] 🔧 Parsed with explicit timezone: ${momentDate.format('DD/MM/YYYY HH:mm:ss')} Thai time`);
        return momentDate;
      }
    }

 
    const momentDate = moment.tz(dateStr, 'Asia/Bangkok');
    if (momentDate.isValid()) {
      console.log(`[${getTimestamp()}] 🔧 Parsed as Thai timezone: ${momentDate.format('DD/MM/YYYY HH:mm:ss')} Thai time`);
      return momentDate;
    }

  
    const utcMoment = moment.utc(dateStr);
    if (utcMoment.isValid()) {
      const thaiMoment = utcMoment.tz('Asia/Bangkok');
      console.log(`[${getTimestamp()}] 🔧 Converted from UTC to Thai: ${thaiMoment.format('DD/MM/YYYY HH:mm:ss')} Thai time`);
      return thaiMoment;
    }

    return null;
  } catch (error) {
    console.log(`[${getTimestamp()}] ❌ Error parsing date:`, error);
    return null;
  }
}

function createTaskFlexMessage(task) {
  const messageDate = task.parsedMoment || getCurrentThaiTime();
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
                    text: `Repeat: ${task.repeat || 'Never'}`,
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
            action: {
              type: "postback",
              label: "Done",
              data: `complete_task_${task.id}`,
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
    const fetch = (await import('node-fetch')).default;
    
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
      const errorTime = getTimestamp();
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

async function checkNotifications() {
  const startTime = getTimestamp();
  console.log(`[${startTime}] 🔍 Starting notification check process...`);
  
  try {
 
    const now = getCurrentThaiTime();
    console.log(`[${getTimestamp()}] 📊 Current time (Thailand): ${now.format('DD/MM/YYYY HH:mm:ss')} (UTC: ${moment().utc().format('YYYY-MM-DD HH:mm:ss')}Z)`);
    
    const notificationsRef = db.collection('tasks');
    console.log(`[${getTimestamp()}] 🔗 Connected to Firestore collection: tasks`);
    
    const queryStartTime = Date.now();
    console.log(`[${getTimestamp()}] 🔎 Querying upcoming notifications...`);
    
    const snapshot = await notificationsRef
      .where('status', '==', 'Upcoming')
      .get();
    
    const queryEndTime = Date.now();
    const queryDuration = queryEndTime - queryStartTime;
    console.log(`[${getTimestamp()}] 📊 Query completed in ${queryDuration}ms`);
    
    if (snapshot.empty) {
      console.log(`[${getTimestamp()}] 📭 No upcoming notifications found`);
      return;
    }
    
    console.log(`[${getTimestamp()}] 📋 Found ${snapshot.size} upcoming notification(s)`);
    
    const filterStartTime = getTimestamp();
    console.log(`[${filterStartTime}] 🔄 Filtering notifications by date...`);
    
    const notifications = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      
      console.log(`[${getTimestamp()}] 🔍 Raw date value: "${data.date}" (type: ${typeof data.date})`);
      
      const parsedMoment = parseFirebaseDate(data.date);
      
      if (parsedMoment && parsedMoment.isValid()) {
        const dateString = parsedMoment.format('DD/MM/YYYY HH:mm:ss');
        console.log(`[${getTimestamp()}] ✅ Parsed date successfully: ${dateString}`);
        
        console.log(`[${getTimestamp()}] 📅 Checking notification: "${data.title}" scheduled for ${dateString}`);
        console.log(`[${getTimestamp()}] ⏰ Comparing times:`);
        console.log(`[${getTimestamp()}]    📍 Current: ${now.format('DD/MM/YYYY HH:mm:ss')} (Thai time: ${now.format('YYYY-MM-DD HH:mm:ss')} +7)`);
        console.log(`[${getTimestamp()}]    🎯 Target:  ${parsedMoment.format('DD/MM/YYYY HH:mm:ss')} (Thai time: ${parsedMoment.format('YYYY-MM-DD HH:mm:ss')} +7)`);
        
        const diffSeconds = parsedMoment.diff(now, 'seconds');
        console.log(`[${getTimestamp()}]    ⏱️  Difference: ${diffSeconds} seconds`);
        
     
        if (now.isSameOrAfter(parsedMoment) || Math.abs(diffSeconds) <= 60) {
          console.log(`[${getTimestamp()}] ✅ Notification "${data.title}" is ready to send!`);
          notifications.push({
            id: doc.id,
            ref: doc.ref,
            ...data,
            parsedMoment: parsedMoment
          });
        } else {
          const minutesRemaining = Math.ceil(diffSeconds / 60);
          console.log(`[${getTimestamp()}] ⏳ Notification "${data.title}" not yet ready`);
          console.log(`[${getTimestamp()}]    ⏰ Time remaining: ${minutesRemaining} minutes (${diffSeconds} seconds)`);
        }
      } else {
        console.log(`[${getTimestamp()}] ⚠️  Skipping notification "${data.title}" due to invalid date: ${data.date}`);
      }
    });
    
    const filterEndTime = getTimestamp();
    console.log(`[${filterEndTime}] ✅ Filtering completed`);
    
    if (notifications.length === 0) {
      console.log(`[${getTimestamp()}] 📭 No notifications ready to send at this time`);
      return;
    }
    
    console.log(`[${getTimestamp()}] 📬 Found ${notifications.length} notification(s) ready to send`);
    
    for (let i = 0; i < notifications.length; i++) {
      const notification = notifications[i];
      const processStartTime = getTimestamp();
      console.log(`[${processStartTime}] 📤 Processing notification ${i + 1}/${notifications.length}: "${notification.title}"`);
      
      const flexMessage = createTaskFlexMessage(notification);
      console.log(`[${getTimestamp()}] 💬 Flex message created for notification: "${notification.title}"`);

      const sendStartTime = getTimestamp();
      console.log(`[${sendStartTime}] 🚀 Sending flex message to user: ${notification.userId}`);
      
      const success = await sendLineMessage(notification.userId, flexMessage);
      
      if (success) {
        const updateStartTime = getTimestamp();
        console.log(`[${updateStartTime}] 📝 Processing repeat logic for notification...`);
        
        const repeatType = notification.repeat || 'Never';
        console.log(`[${getTimestamp()}] 🔄 Repeat type: ${repeatType}`);
        
        if (repeatType.toLowerCase() === 'never') {
          console.log(`[${getTimestamp()}] ⏰ Task doesn't repeat - updating status to 'Overdue'`);
          
          await notification.ref.update({
            status: 'Overdue', 
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            notificationSent: true
          });
          
          console.log(`[${getTimestamp()}] ✅ Task "${notification.title}" status updated to Overdue`);
          
        } else {
          const nextDate = calculateNextDate(notification.parsedMoment.toDate(), repeatType);
          
          if (nextDate) {
            const formattedNextDate = formatDateForFirestore(nextDate);
            console.log(`[${getTimestamp()}] 📅 Next occurrence calculated: ${formattedNextDate}`);
            
            await notification.ref.update({
              date: formattedNextDate,
              status: 'Upcoming',
              lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
              notificationSent: true,
              repeatCount: admin.firestore.FieldValue.increment(1),
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            
            console.log(`[${getTimestamp()}] ✅ Task "${notification.title}" rescheduled for next ${repeatType.toLowerCase()} occurrence`);
          } else {
            console.log(`[${getTimestamp()}] ⚠️  Unable to calculate next date for repeat type: ${repeatType}`);
            
            await notification.ref.update({
              status: 'Overdue', 
              sentAt: admin.firestore.FieldValue.serverTimestamp(),
              notificationSent: true,
              error: 'Unable to calculate next repeat date'
            });
            
            console.log(`[${getTimestamp()}] ⚠️  Task "${notification.title}" marked as Overdue due to repeat calculation error`);
          }
        }
        
        const updateEndTime = getTimestamp();
        console.log(`[${updateEndTime}] ✅ Notification "${notification.title}" processed successfully`);
      } else {
        console.log(`[${getTimestamp()}] ❌ Failed to process notification "${notification.title}"`);
      }
      
      const processEndTime = getTimestamp();
      console.log(`[${processEndTime}] 🏁 Completed processing notification ${i + 1}/${notifications.length}`);
    }
    
    const endTime = getTimestamp();
    console.log(`[${endTime}] 🎉 All notifications processed successfully`);
    
  } catch (error) {
    const errorTime = getTimestamp();
    console.error(`[${errorTime}] ❌ Error in checkNotifications:`, error);
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