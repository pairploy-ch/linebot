const cron = require('node-cron');
const admin = require('firebase-admin');
const path = require('path');


const serviceAccountPath = path.join(__dirname, 'firebase-key.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccountPath),
    projectId: "botyourassistant-33a1a"
  });
}

const db = admin.firestore();


const LINE_ACCESS_TOKEN = 'B4rIu/T52erQu0RQ8YBqnO0020L3Bd4fSqTu8OYiHSTxnuJ5wpPXbtBTqcaFEZgIFyo9EdmyiLvXLErHn+AWtS4zHib7InjUSx96viPy5FYLaFQaTOofp778ZpULSLaVmhnLybtAVMBb+mNuwrrzuAdB04t89/1O/w1cDnyilFU=';


function getTimestamp() {
  return new Date().toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}


function calculateNextDate(currentDate, repeatType) {
  const nextDate = new Date(currentDate);
  
  switch (repeatType.toLowerCase()) {
    case 'daily':
      nextDate.setDate(nextDate.getDate() + 1);
      break;
    case 'weekly':
      nextDate.setDate(nextDate.getDate() + 7);
      break;
    case 'monthly':
      nextDate.setMonth(nextDate.getMonth() + 1);
      break;
    default:
      return null; // For 'never' or unknown repeat types
  }
  
  return nextDate;
}


function formatDateForFirestore(date) {
  const options = {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "2-digit",
    hour12: true,
    timeZone: "Asia/Bangkok",
  };

  const formatted = date.toLocaleDateString("en-US", options);
  return `${formatted} UTC+7`;
}


function createTaskFlexMessage(task) {
  const messageDate = task.parsedDate || new Date(task.date);
  const dateDisplay = messageDate && !isNaN(messageDate.getTime()) 
    ? messageDate.toLocaleString('th-TH')
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
    const now = new Date();
    console.log(`[${getTimestamp()}] 📊 Current time: ${now.toLocaleString('th-TH')}`);
    
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
      
      let notificationDate;
      let dateString = 'Invalid Date';
      let isValidDate = false;
      
      try {
        if (data.date) {
          console.log(`[${getTimestamp()}] 🔍 Raw date value: "${data.date}" (type: ${typeof data.date})`);
          
          if (data.date.toDate && typeof data.date.toDate === 'function') {
            notificationDate = data.date.toDate();
            isValidDate = true;
            dateString = notificationDate.toLocaleString('th-TH');
            console.log(`[${getTimestamp()}] ✅ Parsed Firestore Timestamp successfully: ${dateString}`);
          } else {
            let tempDate = new Date(data.date);
            
            if (isNaN(tempDate.getTime())) {
              const dateStr = data.date.toString();
              
              if (dateStr.includes(' at ') && dateStr.includes('UTC+7')) {
                const parts = dateStr.split(' at ');
                const datePart = parts[0];
                const timePart = parts[1].replace(' UTC+7', '');
                const standardFormat = `${datePart} ${timePart}`;
                
                console.log(`[${getTimestamp()}] 🔄 Trying to parse: "${standardFormat}"`);
                tempDate = new Date(standardFormat);
              }
            }
            
            if (!isNaN(tempDate.getTime())) {
              notificationDate = tempDate;
              isValidDate = true;
              dateString = notificationDate.toLocaleString('th-TH');
              console.log(`[${getTimestamp()}] ✅ Parsed date string successfully: ${dateString}`);
            } else {
              console.log(`[${getTimestamp()}] ❌ Failed to parse date string: ${data.date}`);
              dateString = `Invalid Date (${data.date})`;
            }
          }
        } else {
          console.log(`[${getTimestamp()}] ⚠️  No date field found for "${data.title}"`);
          dateString = 'No Date';
        }
      } catch (error) {
        console.log(`[${getTimestamp()}] ❌ Error parsing date for "${data.title}":`, error);
        dateString = `Error parsing date (${data.date})`;
      }
      
      console.log(`[${getTimestamp()}] 📅 Checking notification: "${data.title}" scheduled for ${dateString}`);
      
      if (isValidDate && notificationDate) {
        console.log(`[${getTimestamp()}] ⏰ Comparing times:`);
        console.log(`[${getTimestamp()}]    📍 Current: ${now.toLocaleString('th-TH')} (${now.toISOString()})`);
        console.log(`[${getTimestamp()}]    🎯 Target:  ${notificationDate.toLocaleString('th-TH')} (${notificationDate.toISOString()})`);
        console.log(`[${getTimestamp()}]    ⏱️  Difference: ${Math.round((notificationDate - now) / 1000)} seconds`);
        
        if (notificationDate <= now) {
          console.log(`[${getTimestamp()}] ✅ Notification "${data.title}" is ready to send!`);
          notifications.push({
            id: doc.id,
            ref: doc.ref,
            ...data,
            parsedDate: notificationDate
          });
        } else {
          const minutesRemaining = Math.ceil((notificationDate - now) / 1000 / 60);
          const secondsRemaining = Math.ceil((notificationDate - now) / 1000);
          console.log(`[${getTimestamp()}] ⏳ Notification "${data.title}" not yet ready`);
          console.log(`[${getTimestamp()}]    ⏰ Time remaining: ${minutesRemaining} minutes (${secondsRemaining} seconds)`);
        }
      } else {
        console.log(`[${getTimestamp()}] ⚠️  Skipping notification "${data.title}" due to invalid date`);
      }
    });
    
    const filterEndTime = getTimestamp();
    console.log(`[${filterEndTime}] ✅ Filtering completed`);
    
    if (notifications.length === 0) {
      console.log(`[${getTimestamp()}] 📭 No notifications ready to send at this time`);
      return;
    }
    
    console.log(`[${getTimestamp()}] 📬 Found ${notifications.length} notification(s) ready to send`);
    
    // Process each notification
    for (let i = 0; i < notifications.length; i++) {
      const notification = notifications[i];
      const processStartTime = getTimestamp();
      console.log(`[${processStartTime}] 📤 Processing notification ${i + 1}/${notifications.length}: "${notification.title}"`);
      
      // Create and send flex message
      const flexMessage = createTaskFlexMessage(notification);
      console.log(`[${getTimestamp()}] 💬 Flex message created for notification: "${notification.title}"`);

      const sendStartTime = getTimestamp();
      console.log(`[${sendStartTime}] 🚀 Sending flex message to user: ${notification.userId}`);
      
      const success = await sendLineMessage(notification.userId, flexMessage);
      
      if (success) {
        const updateStartTime = getTimestamp();
        console.log(`[${updateStartTime}] 📝 Processing repeat logic for notification...`);
        
        // Handle repeat logic
        const repeatType = notification.repeat || 'Never';
        console.log(`[${getTimestamp()}] 🔄 Repeat type: ${repeatType}`);
        
        if (repeatType.toLowerCase() === 'never') {
          // If never repeat, change status to Overdue
          console.log(`[${getTimestamp()}] ⏰ Task doesn't repeat - updating status to 'Overdue'`);
          
          await notification.ref.update({
            status: 'Overdue', 
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            notificationSent: true
          });
          
          console.log(`[${getTimestamp()}] ✅ Task "${notification.title}" status updated to Overdue`);
          
        } else {
          // If has repeat pattern, calculate next date and keep as Upcoming
          const nextDate = calculateNextDate(notification.parsedDate, repeatType);
          
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
            
            // Fallback to Overdue if can't calculate next date
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
