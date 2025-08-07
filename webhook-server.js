// Web hook new
const express = require("express");
const admin = require("firebase-admin");
const path = require("path");
const app = express();
const port = 3001;

//ต้องมีตัว firebase-key.json
const serviceAccountPath = require("./firebase-key.json");


if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccountPath),
    projectId: "botyourassistant-33a1a",
  });
}

const db = admin.firestore();


const LINE_ACCESS_TOKEN =
  "wE1+/bnCirraiwTKbLA5UvveJcCYLfulnlLy4FEU1wdk+8a5uNlc7fzYqK/mWayfFyo9EdmyiLvXLErHn+AWtS4zHib7InjUSx96viPy5FZ49S2uKktIGxZEiuQ1sx5xxLX2Wj9UWuhkbQg94XqGigdB04t89/1O/w1cDnyilFU=";


app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "*");
  next();
});

app.use(express.json());


function getTimestamp() {
  return new Date().toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}


async function sendReplyMessage(replyToken, messages) {
  try {
    const fetch = (await import("node-fetch")).default;

    const response = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LINE_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        replyToken: replyToken,
        messages: messages,
      }),
    });

    if (response.ok) {
      console.log(`[${getTimestamp()}] ✅ Reply sent successfully`);
      return true;
    } else {
      const errorText = await response.text();
      console.log(`[${getTimestamp()}] ❌ Error:`, errorText);
      return false;
    }
  } catch (error) {
    console.error(`[${getTimestamp()}] ❌ Error:`, error);
    return false;
  }
}



async function completeTask(taskId, userId) {
  if (!taskId || taskId.trim() === "") {
    throw new Error("Missing taskId");
  }

  const taskRef = db.collection("tasks").doc(taskId);

  await taskRef.update({
    status: "Completed",
    lastUpdated: new Date(), 
  });

  console.log(`✅ Task ${taskId} updated to Completed`);
}

async function getTaskCompletionStats(userId, timeframe = "month") {
  try {
    const now = new Date();
    let startDate = new Date();

    if (timeframe === "week") {
      startDate.setDate(now.getDate() - 7);
    } else if (timeframe === "month") {
      startDate.setMonth(now.getMonth() - 1);
    } else if (timeframe === "year") {
      startDate.setFullYear(now.getFullYear() - 1);
    }

    const tasksQuery = await db
      .collection("tasks")
      .where("userId", "==", userId)
      .where("status", "==", "Completed")
      .where("completedAt", ">=", startDate)
      .get();

    let stats = {
      totalCompleted: 0,
      completedOnTime: 0,
      completedOverdue: 0,
      completedFromLine: 0,
    };

    tasksQuery.docs.forEach((doc) => {
      const data = doc.data();
      stats.totalCompleted++;

      if (data.previousStatus === "Overdue") {
        stats.completedOverdue++;
      } else {
        stats.completedOnTime++;
      }

      if (data.completedFromLine) {
        stats.completedFromLine++;
      }
    });

    return stats;
  } catch (error) {
    console.error(`[${getTimestamp()}] ❌ Error getting task stats:`, error);
    return null;
  }
}

async function remindLater(taskId, userId) {
  try {
    console.log(
      `[${getTimestamp()}] 🔄 Setting remind later for task: ${taskId}`
    );

    const taskRef = db.collection("tasks").doc(taskId);
    const taskDoc = await taskRef.get();

    if (!taskDoc.exists) {
      console.log(`[${getTimestamp()}] ❌ Task not found: ${taskId}`);
      return {
        success: false,
        message: "ไม่พบงานที่ต้องการอัปเดต",
      };
    }

    const taskData = taskDoc.data();

    if (taskData.userId !== userId) {
      console.log(`[${getTimestamp()}] ❌ Task ownership mismatch: ${taskId}`);
      return {
        success: false,
        message: "คุณไม่มีสิทธิ์แก้ไขงานนี้",
      };
    }

   
    const remindTime = new Date();
    remindTime.setHours(remindTime.getHours() + 1);

    await taskRef.update({
      status: "Upcoming",
      remindLaterAt: admin.firestore.FieldValue.serverTimestamp(),
      nextReminder: remindTime.toISOString(),
    });

    console.log(
      `[${getTimestamp()}] ✅ Remind later set successfully: ${taskId}`
    );

    return {
      success: true,
      message: `⏰ ตั้งเตือนงาน "${taskData.title}" ใหม่ในอีก 1 ชั่วโมง`,
      taskTitle: taskData.title,
    };
  } catch (error) {
    console.error(`[${getTimestamp()}] ❌ Error setting remind later:`, error);
    return {
      success: false,
      message: "เกิดข้อผิดพลาดในการตั้งเตือนใหม่",
    };
  }
}


//** function ที่ทำงานหลังจาก User กด Done บน flex Message// 
async function handlePostback(event) {
  const data = event.postback?.data;
  const userId = event.source?.userId;

  if (!data || !userId) return;

  if (data.startsWith("complete_task_")) {
    const taskId = data.replace("complete_task_", "");

    try {
      const taskRef = db.collection("tasks").doc(taskId);
      const taskSnap = await taskRef.get();

      if (!taskSnap.exists) {
        await sendReplyMessage(event.replyToken, [
          {
            type: "text",
            text: "❌ ไม่พบงานที่ระบุในระบบ",
          },
        ]);
        return;
      }

      const taskData = taskSnap.data();


      if (taskData.userId !== userId) {
        await sendReplyMessage(event.replyToken, [
          {
            type: "text",
            text: "❌ คุณไม่มีสิทธิ์ในการอัปเดตงานนี้",
          },
        ]);
        return;
      }

   
      await taskRef.update({
        status: "Completed",
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        completedFromLine: true,

        repeat: "Never",
        repeatStopped: true,
        repeatStoppedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`[${getTimestamp()}] ✅ Task "${taskData.title}" marked as Completed and repeat stopped`);

    
      await sendReplyMessage(event.replyToken, [
        {
          type: "flex",
          altText: "งานถูกอัปเดตเป็นเสร็จแล้วเรียบร้อย",
          contents: {
            type: "bubble",
            header: {
              type: "box",
              layout: "vertical",
              contents: [
                {
                  type: "text",
                  text: "งานเสร็จเรียบร้อยแล้ว!",
                  weight: "bold",
                  color: "#ffffff",
                  size: "lg",
                  align: "center",
                },
              ],
              backgroundColor: "#10b981",
              paddingAll: "20px",
            },
            body: {
              type: "box",
              layout: "vertical",
              contents: [
                {
                  type: "box",
                  layout: "vertical",
                  margin: "md",
                  spacing: "sm",
                  contents: [
                    {
                      type: "box",
                      layout: "baseline",
                      spacing: "sm",
                      contents: [
                        {
                          type: "text",
                          text: "📋 ชื่องาน:",
                          color: "#aaaaaa",
                          size: "sm",
                          flex: 2,
                        },
                        {
                          type: "text",
                          text: taskData.title || "ไม่ระบุชื่อ",
                          wrap: true,
                          size: "sm",
                          flex: 5,
                        },
                      ],
                    },
                    {
                      type: "box",
                      layout: "baseline",
                      spacing: "sm",
                      contents: [
                        {
                          type: "text",
                          text: "✅ สถานะ:",
                          color: "#aaaaaa",
                          size: "sm",
                          flex: 2,
                        },
                        {
                          type: "text",
                          text: "งานเสร็จสิ้นแล้ว",
                          wrap: true,
                          size: "sm",
                          flex: 5,
                          color: "#059669",
                        },
                      ],
                    },
              
                  ],
                },
              ],
              paddingAll: "20px",
            },
            styles: {
              body: {
                backgroundColor: "#F0F9F3",
              },
            },
          },
        },
      ]);

      console.log(`[${getTimestamp()}] 🔥 Postback complete_task processed: ${taskId}`);
    } catch (error) {
      console.error(`[${getTimestamp()}] ❌ Error processing complete_task:`, error);

      await sendReplyMessage(event.replyToken, [
        {
          type: "text",
          text: "❌ เกิดข้อผิดพลาดในการอัปเดตงาน กรุณาลองใหม่",
        },
      ]);
    }

    return;
  }
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
      return null; 
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

async function handleMessage(event) {
  const messageText = event.message.text;
  const userId = event.source.userId;

  console.log(
    `[${getTimestamp()}] 💬 Text message received: "${messageText}" from user: ${userId}`
  );

 
  const replyMessage = {
    type: "text",
    text: `ได้รับข้อความ: ${messageText} 🤖\n\nใช้งานผ่านเว็บแอป: https://your-domain.com`,
  };

  await sendReplyMessage(event.replyToken, [replyMessage]);
}


app.post("/webhook", (req, res) => {
  const receivedTime = getTimestamp();
  console.log(`[${receivedTime}] 📩 Webhook received!`);
  console.log(
    `[${getTimestamp()}] 🔍 Headers:`,
    JSON.stringify(req.headers, null, 2)
  );
  console.log(
    `[${getTimestamp()}] 📦 Body:`,
    JSON.stringify(req.body, null, 2)
  );


  res.status(200).send("OK");
  console.log(`[${getTimestamp()}] 📤 Responded 200 OK to LINE platform`);

 
  const events = req.body.events || [];
  console.log(
    `[${getTimestamp()}] 📊 Number of events to process: ${events.length}`
  );

  if (events.length === 0) {
    console.log(`[${getTimestamp()}] ℹ️ No events to process`);
    return;
  }

  events.forEach(async (event, index) => {
    try {
      console.log(
        `[${getTimestamp()}] 🔄 Processing event ${index + 1}/${events.length}:`
      );
      console.log(`[${getTimestamp()}] 📋 Event type: ${event.type}`);
      console.log(
        `[${getTimestamp()}] 👤 User ID: ${event.source?.userId || "Unknown"}`
      );
      console.log(
        `[${getTimestamp()}] 🎫 Reply token: ${event.replyToken || "None"}`
      );

      if (event.type === "message" && event.message?.type === "text") {
        console.log(
          `[${getTimestamp()}] 💬 Processing text message: "${
            event.message.text
          }"`
        );
        await handleMessage(event);
      } else if (event.type === "postback") {
        console.log(
          `[${getTimestamp()}] 🎯 Processing postback data: "${
            event.postback?.data
          }"`
        );
        console.log(
          `[${getTimestamp()}] 📄 Postback params:`,
          event.postback?.params || "None"
        );
        await handlePostback(event);
      } else if (event.type === "follow") {
        console.log(
          `[${getTimestamp()}] 👋 User followed the bot: ${
            event.source?.userId
          }`
        );
      
      } else if (event.type === "unfollow") {
        console.log(
          `[${getTimestamp()}] 👋 User unfollowed the bot: ${
            event.source?.userId
          }`
        );
      
      } else {
        console.log(
          `[${getTimestamp()}] ℹ️ Unhandled event type: ${event.type}`
        );
        if (event.message) {
          console.log(
            `[${getTimestamp()}] 📄 Message type: ${event.message.type}`
          );
        }
      }

      console.log(
        `[${getTimestamp()}] ✅ Completed processing event ${index + 1}/${
          events.length
        }`
      );
    } catch (error) {
      console.error(
        `[${getTimestamp()}] ❌ Error processing event ${index + 1}/${
          events.length
        }:`,
        error
      );
      console.error(
        `[${getTimestamp()}] ❌ Event data:`,
        JSON.stringify(event, null, 2)
      );
      console.error(`[${getTimestamp()}] ❌ Error stack:`, error.stack);

  
      if (event.replyToken) {
        try {
          const errorReply = {
            type: "text",
            text: "เกิดข้อผิดพลาดในการประมวลผล กรุณาลองใหม่อีกครั้ง",
          };
          await sendReplyMessage(event.replyToken, [errorReply]);
          console.log(`[${getTimestamp()}] 📤 Error notification sent to user`);
        } catch (replyError) {
          console.error(
            `[${getTimestamp()}] ❌ Failed to send error notification:`,
            replyError
          );
        }
      }
    }
  });

  console.log(
    `[${getTimestamp()}] 🏁 Finished processing all ${events.length} events`
  );
});


app.post("/test-complete-task", async (req, res) => {
  const { taskId, userId } = req.body;

  console.log(
    `[${getTimestamp()}] 🧪 Test complete task - taskId: ${taskId}, userId: ${userId}`
  );

  if (!taskId || !userId) {
    return res.status(400).json({
      success: false,
      message: "taskId and userId are required",
    });
  }

  try {
    const result = await completeTask(taskId, userId);
    console.log(`[${getTimestamp()}] 🧪 Test result:`, result);

    res.json(result);
  } catch (error) {
    console.error(`[${getTimestamp()}] 🧪 Test error:`, error);
    res.status(500).json({
      success: false,
      message: error.message,
      error: error.stack,
    });
  }
});


app.get("/task-status/:taskId", async (req, res) => {
  const { taskId } = req.params;

  try {
    const taskRef = db.collection("tasks").doc(taskId);
    const taskDoc = await taskRef.get();

    if (!taskDoc.exists) {
      return res.status(404).json({
        exists: false,
        message: "Task not found",
      });
    }

    const taskData = taskDoc.data();

    res.json({
      exists: true,
      taskId: taskId,
      status: taskData.status,
      title: taskData.title,
      userId: taskData.userId,
      createdAt: taskData.createdAt?.toDate?.() || taskData.createdAt,
      completedAt: taskData.completedAt?.toDate?.() || taskData.completedAt,
      lastUpdated: taskData.lastUpdated?.toDate?.() || taskData.lastUpdated,
      completedFromLine: taskData.completedFromLine || false,
      previousStatus: taskData.previousStatus || null,
      repeat: taskData.repeat || "Never",
      repeatStopped: taskData.repeatStopped || false,
    });
  } catch (error) {
    console.error(`[${getTimestamp()}] ❌ Error fetching task status:`, error);
    res.status(500).json({
      error: error.message,
    });
  }
});


app.get("/", (req, res) => {
  res.json({
    status: "running",
    message: "LINE Bot Webhook Server Running! 🚀",
    timestamp: getTimestamp(),
    endpoints: {
      webhook: "/webhook",
      health: "/",
    },
  });
});


app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: getTimestamp(),
    uptime: process.uptime(),
  });
});


app.listen(port, () => {
  console.log(
    `[${getTimestamp()}] 🚀 Webhook server running at http://localhost:${port}`
  );
  console.log(
    `[${getTimestamp()}] 📝 Webhook URL: http://localhost:${port}/webhook`
  );
  console.log(
    `[${getTimestamp()}] ❤️  Health check: http://localhost:${port}/health`
  );
  console.log(
    `[${getTimestamp()}] 🎯 Ready to handle task completion actions!`
  );
});


process.on("SIGINT", () => {
  console.log(
    `\n[${getTimestamp()}] 🛑 Received shutdown signal - Gracefully shutting down webhook server...`
  );
  process.exit(0);
});

module.exports = app;