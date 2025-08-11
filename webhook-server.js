const express = require("express");
const admin = require("firebase-admin");
const path = require("path");
const openai = require("openai");
const moment = require("moment-timezone");
const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 3001;

// Load environment variables
require('dotenv').config();

// Securely load Firebase credentials
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
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Initialize OpenAI client
const openaiClient = new openai.OpenAI({
  apiKey: OPENAI_API_KEY
});

// Configure Express middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "*");
  next();
});
app.use(express.json());

function getTimestamp() {
  return moment().tz('Asia/Singapore').format('DD/MM/YYYY HH:mm:ss');
}

async function sendReplyMessage(replyToken, messages) {
  try {
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

async function classifyMessageWithAI(prompt) {
  const classificationPrompt = `
    You are an intent classifier for a personal assistant. Your job is to determine the user's intent from the message and respond with a single, specific category code. Do not include any other text, explanation, or punctuation.
    
    Categories:
    - create_task: User wants to create a new task or reminder.
    - read_task: User wants to view, list, or check their existing tasks.
    - edit_task: User wants to modify or update a task.
    - delete_task: User wants to delete or cancel a task.
    - complete_task: User wants to mark a task as completed.
    - health_query: User is asking a medical or health-related question.
    - weather_check: User wants to know the weather for a location.
    - general_search: User is asking a general knowledge question or for a summary.
    - create_content: User wants to draft an email, social media post, or other text.
    - unknown: The intent does not match any of the above categories.

    User message: "${prompt}"
    
    Your response (single category code only):
  `;

  const response = await openaiClient.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: classificationPrompt }],
    max_tokens: 10,
    temperature: 0,
  });

  const category = response.choices[0].message.content.trim();
  console.log(`[${getTimestamp()}] 🤖 AI Classified intent: ${category}`);
  return category;
}

async function extractTaskDetailsWithAI(userMessage) {
  const system_prompt = `
    รับคำสั่งสร้าง reminder แปลงเป็น JSON

    {
      "intent": "add_reminder",
      "task": "<สิ่งที่ต้องทำ>", (ไม่เกิน 5 คำ)
      "time": "<HH:MM>",
      "date": "<YYYY-MM-DD>",
      "repeat": "<once | daily | weekly | monthly | yearly>"
    }

    กติกา:
    - “พรุ่งนี้”, “วันนี้” → แปลงเป็นวันที่จริง today date is ${moment().tz('Asia/Singapore').format("YYYY-MM-DD HH:mm")}
    - “ทุกวัน/พุธ” → set repeat ให้ตรง
    - ไม่มีคำซ้ำ → repeat = once
    ตอบกลับเป็น JSON เท่านั้น ห้ามมีคำอธิบาย

    ถ้าไม่มี task ให้เขียนส่งเป็นไฟล์ json
    {
    "error" : "title" 
    }

    ถ้าไม่มีเวลาบอก > 8.00
    ถ้าไม่มีวันที่บอก > วันนี้
  `;

  const response = await openaiClient.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: system_prompt },
      { role: "user", content: userMessage }
    ],
    response_format: { type: "json_object" }
  });

  const rawContent = response.choices[0].message.content;
  console.log(`[${getTimestamp()}] 🤖 AI Response: ${rawContent}`);
  return JSON.parse(rawContent);
}


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
        await sendReplyMessage(event.replyToken, [{ type: "text", text: "❌ ไม่พบงานที่ระบุในระบบ" }]);
        return;
      }

      const taskData = taskSnap.data();

      if (taskData.userId !== userId) {
        await sendReplyMessage(event.replyToken, [{ type: "text", text: "❌ คุณไม่มีสิทธิ์ในการอัปเดตงานนี้" }]);
        return;
      }

      const notificationsQuery = await db.collection("tasks").doc(taskId).collection("notifications").get();
      if (!notificationsQuery.empty) {
        const notificationRef = notificationsQuery.docs[0].ref;
        await notificationRef.update({
          status: "Completed",
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      console.log(`[${getTimestamp()}] ✅ Task "${taskData.title}" marked as Completed`);
      await sendReplyMessage(event.replyToken, [{ type: "text", text: `✅ งาน "${taskData.title}" ถูกทำเครื่องหมายว่าเสร็จสิ้นแล้ว` }]);

    } catch (error) {
      console.error(`[${getTimestamp()}] ❌ Error processing complete_task:`, error);
      await sendReplyMessage(event.replyToken, [{ type: "text", text: "❌ เกิดข้อผิดพลาดในการอัปเดตงาน กรุณาลองใหม่" }]);
    }
    return;
  }
}

app.post("/webhook", (req, res) => {
  const receivedTime = getTimestamp();
  console.log(`[${receivedTime}] 📩 Webhook received!`);
  res.status(200).send("OK");

  const events = req.body.events || [];
  if (events.length === 0) return;

  events.forEach(async (event, index) => {
    try {
      if (event.type === "message" && event.message?.type === "text") {
        const messageText = event.message.text;

        if (!messageText.toLowerCase().startsWith("alin") && !messageText.startsWith("อลิน")) {
          const replyMessage = { type: "text", text: `ได้รับข้อความ: ${messageText} 🤖\n\nใช้งานผ่านเว็บแอป: https://your-domain.com` };
          await sendReplyMessage(event.replyToken, [replyMessage]);
          return;
        }

        const aiPrompt = messageText.substring(messageText.indexOf(" ") + 1);
        const characterThreshold = 500;

        if (aiPrompt.length > characterThreshold) {
          const replyMessage = { type: "text", text: "ข้อความของคุณยาวเกินไป กรุณาพิมพ์ให้กระชับยิ่งขึ้น" };
          await sendReplyMessage(event.replyToken, [replyMessage]);
          return;
        }

        const intent = await classifyMessageWithAI(aiPrompt);

        switch (intent) {
          case 'create_task':
            // Second layer of AI processing
            const taskDetails = await extractTaskDetailsWithAI(aiPrompt);
            // Send the JSON output from the second layer back to the user
            await sendReplyMessage(event.replyToken, [{ type: "text", text: JSON.stringify(taskDetails, null, 2) }]);
            break;
          case 'read_task':
            await sendReplyMessage(event.replyToken, [{ type: "text", text: "ฟังก์ชันการดูงานยังอยู่ระหว่างการพัฒนา" }]);
            break;
          case 'edit_task':
            await sendReplyMessage(event.replyToken, [{ type: "text", text: "ฟังก์ชันการแก้ไขงานยังอยู่ระหว่างการพัฒนา" }]);
            break;
          case 'delete_task':
            await sendReplyMessage(event.replyToken, [{ type: "text", text: "ฟังก์ชันการลบงานยังอยู่ระหว่างการพัฒนา" }]);
            break;
          case 'complete_task':
            await sendReplyMessage(event.replyToken, [{ type: "text", text: "ฟังก์ชันการทำเครื่องหมายว่างานเสร็จสิ้นยังอยู่ระหว่างการพัฒนา" }]);
            break;
          case 'health_query':
            await sendReplyMessage(event.replyToken, [{ type: "text", text: "ฟังก์ชันการสอบถามสุขภาพยังอยู่ระหว่างการพัฒนา" }]);
            break;
          case 'weather_check':
            await sendReplyMessage(event.replyToken, [{ type: "text", text: "ฟังก์ชันการตรวจสอบสภาพอากาศยังอยู่ระหว่างการพัฒนา" }]);
            break;
          case 'general_search':
            await sendReplyMessage(event.replyToken, [{ type: "text", text: "ฟังก์ชันการค้นหาทั่วไปยังอยู่ระหว่างการพัฒนา" }]);
            break;
          case 'create_content':
            await sendReplyMessage(event.replyToken, [{ type: "text", text: "ฟังก์ชันการสร้างเนื้อหายังอยู่ระหว่างการพัฒนา" }]);
            break;
          default:
            await sendReplyMessage(event.replyToken, [{ type: "text", text: "ขออภัย อลินยังไม่สามารถจัดการคำสั่งนี้ได้" }]);
        }

      } else if (event.type === "postback") {
        await handlePostback(event);
      } else if (event.type === "follow") {
        console.log(`[${getTimestamp()}] 👋 User followed the bot: ${event.source?.userId}`);
      } else if (event.type === "unfollow") {
        console.log(`[${getTimestamp()}] 👋 User unfollowed the bot: ${event.source?.userId}`);
      } else {
        console.log(`[${getTimestamp()}] ℹ️ Unhandled event type: ${event.type}`);
        if (event.message) {
          console.log(`[${getTimestamp()}] 📄 Message type: ${event.message.type}`);
        }
      }
      console.log(`[${getTimestamp()}] ✅ Completed processing event ${index + 1}/${events.length}`);
    } catch (error) {
      console.error(`[${getTimestamp()}] ❌ Error processing event ${index + 1}/${events.length}:`, error);
      console.error(`[${getTimestamp()}] ❌ Event data:`, JSON.stringify(event, null, 2));
      console.error(`[${getTimestamp()}] ❌ Error stack:`, error.stack);

      if (event.replyToken) {
        try {
          const errorReply = { type: "text", text: "เกิดข้อผิดพลาดในการประมวลผล กรุณาลองใหม่อีกครั้ง" };
          await sendReplyMessage(event.replyToken, [errorReply]);
          console.log(`[${getTimestamp()}] 📤 Error notification sent to user`);
        } catch (replyError) {
          console.error(`[${getTimestamp()}] ❌ Failed to send error notification:`, replyError);
        }
      }
    }
  });

  console.log(`[${getTimestamp()}] 🏁 Finished processing all ${events.length} events`);
});


app.post("/test-complete-task", async (req, res) => {
  const { taskId, userId } = req.body;
  if (!taskId || !userId) {
    return res.status(400).json({ success: false, message: "taskId and userId are required", });
  }
  try {
    const result = await completeTask(taskId, userId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message, error: error.stack, });
  }
});


app.get("/task-status/:taskId", async (req, res) => {
  const { taskId } = req.params;
  try {
    const taskRef = db.collection("tasks").doc(taskId);
    const taskDoc = await taskRef.get();
    if (!taskDoc.exists) {
      return res.status(404).json({ exists: false, message: "Task not found", });
    }
    const taskData = taskDoc.data();
    res.json({
      exists: true, taskId: taskId, status: taskData.status, title: taskData.title, userId: taskData.userId,
      createdAt: taskData.createdAt?.toDate?.() || taskData.createdAt, completedAt: taskData.completedAt?.toDate?.() || taskData.completedAt,
      lastUpdated: taskData.lastUpdated?.toDate?.() || taskData.lastUpdated, completedFromLine: taskData.completedFromLine || false,
      previousStatus: taskData.previousStatus || null, repeat: taskData.repeat || "Never", repeatStopped: taskData.repeatStopped || false,
    });
  } catch (error) {
    res.status(500).json({ error: error.message, });
  }
});


app.get("/", (req, res) => {
  res.json({
    status: "running", message: "LINE Bot Webhook Server Running! 🚀", timestamp: getTimestamp(),
    endpoints: { webhook: "/webhook", health: "/", },
  });
});


app.get("/health", (req, res) => {
  res.json({ status: "healthy", timestamp: getTimestamp(), uptime: process.uptime(), });
});


app.listen(port, () => {
  console.log(`[${getTimestamp()}] 🚀 Webhook server running at http://localhost:${port}`);
  console.log(`[${getTimestamp()}] 📝 Webhook URL: http://localhost:${port}/webhook`);
  console.log(`[${getTimestamp()}] ❤️  Health check: http://localhost:${port}/health`);
  console.log(`[${getTimestamp()}] 🎯 Ready to handle task completion actions!`);
});

module.exports = app;