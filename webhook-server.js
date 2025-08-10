const express = require("express");
const admin = require("firebase-admin");
const path = require("path");
const openai = require("openai");

const app = express();
const port = process.env.PORT || 3001;

// Load environment variables for AI and LINE
require('dotenv').config();

// Securely load Firebase credentials from environment variable
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


async function extractDetailsWithAI(prompt, intent) {
  let detailsPrompt = '';

  if (intent === 'create_task') {
    detailsPrompt = `Extract the following details from the message and return a JSON object. If a detail is not found, use null. Your response must be only the JSON object, with no other text.
    
    Details to extract:
    - title: A short title for the task (string)
    - detail: A more detailed description (string)
    - date: The date in "YYYY-MM-DD" format (string).
    - time: The time in "HH:mm" format (string).
    - repeat: "Daily", "Weekly", "Monthly", or "Never" (string)
    
    User's message: "${prompt}"`;
  } else if (intent === 'edit_task' || intent === 'delete_task' || intent === 'complete_task' || intent === 'read_task') {
    detailsPrompt = `Extract the following details from the message to identify a task. If a detail is not found, use null. Your response must be only a JSON object, with no other text.
    
    Details to extract:
    - title_keyword: A key phrase from the task title (string)
    - date: The date in "YYYY-MM-DD" format (string).
    - time: The time in "HH:mm" format (string).
    
    User's message: "${prompt}"`;
  } else if (intent === 'weather_check') {
    detailsPrompt = `Extract a city name or location from the following message. Respond with only the location name. Do not add any other text.
    
    Example 1: "วันนี้ที่กรุงเทพอากาศเป็นยังไง" -> "กรุงเทพ"
    Example 2: "อากาศตอนนี้ที่ภูเก็ต" -> "ภูเก็ต"

    User's message: "${prompt}"`;
  } else if (intent === 'create_content') {
    detailsPrompt = `You are a writing assistant. Draft a response based on the following user request. The user is expecting a well-written, professional draft.

    User's request: "${prompt}"`;
  } else if (intent === 'health_query') {
    detailsPrompt = `You are a medical information assistant. Provide a helpful, general response to the following query. Always include a disclaimer that this is not a substitute for professional medical advice.
    
    User query: "${prompt}"`;
  } else if (intent === 'general_search') {
    detailsPrompt = prompt;
  }
  
  const response = await openaiClient.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: detailsPrompt }],
    response_format: intent.endsWith('_task') ? { type: "json_object" } : undefined
  });

  const responseContent = response.choices[0].message.content;
  if (intent.endsWith('_task')) {
    return JSON.parse(responseContent);
  }
  return responseContent;
}


async function handleCreateTask(event, prompt) {
  const taskDetails = await extractDetailsWithAI(prompt, 'create_task');
  
  if (!taskDetails.title || !taskDetails.date) {
    await sendReplyMessage(event.replyToken, [{ type: "text", text: "ขออภัย อลินไม่สามารถเข้าใจรายละเอียดของงานได้ กรุณาลองใหม่อีกครั้ง" }]);
    return;
  }
  
  const newTask = {
    ...taskDetails,
    userId: event.source.userId,
    status: "Upcoming",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  
  const docRef = await db.collection("tasks").add(newTask);
  const flexMessage = {
    type: "flex",
    altText: "งานใหม่ถูกสร้างเรียบร้อยแล้ว",
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [{ type: "text", text: "งานเสร็จเรียบร้อยแล้ว!", weight: "bold", color: "#ffffff", size: "lg", align: "center" }],
        backgroundColor: "#10b981",
        paddingAll: "20px",
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "box", layout: "vertical", margin: "md", spacing: "sm", contents: [
            { type: "box", layout: "baseline", spacing: "sm", contents: [
              { type: "text", text: "📋 ชื่องาน:", color: "#aaaaaa", size: "sm", flex: 2, },
              { type: "text", text: newTask.title || "ไม่ระบุชื่อ", wrap: true, size: "sm", flex: 5, },
            ], },
          ], },
        ],
        paddingAll: "20px",
      },
      styles: { body: { backgroundColor: "#F0F9F3" } },
    },
  };
  await sendReplyMessage(event.replyToken, [flexMessage]);
}

async function handleReadTask(event, prompt) {
  const user_id = event.source.userId;
  const filter = await extractDetailsWithAI(prompt, 'read_task');
  
  let q = db.collection("tasks").where("userId", "==", user_id);
  
  if (filter.title_keyword) {
     q = q.where("title", "==", filter.title_keyword);
  }
  if (filter.date) {
    q = q.where("date", "==", filter.date);
  }
  
  const snapshot = await q.get();
  let tasks = [];
  snapshot.forEach(doc => tasks.push(doc.data()));
  
  const replyText = tasks.length > 0
    ? tasks.map(task => `📋 ${task.title}: ${task.detail || ''} (${task.date} at ${task.time})`).join('\\n')
    : "ไม่พบงานที่ตรงกับเงื่อนไข";
    
  await sendReplyMessage(event.replyToken, [{ type: "text", text: replyText }]);
}

async function handleEditTask(event, prompt) {
  const user_id = event.source.userId;
  const updateDetails = await extractDetailsWithAI(prompt, 'edit_task');

  // Find the task to update (based on title_keyword and date/time)
  // ... This logic would need to be implemented
  // updateDoc(docRef, { ...updateDetails });
  
  await sendReplyMessage(event.replyToken, [{ type: "text", text: "ฟังก์ชันการแก้ไขงานยังอยู่ระหว่างการพัฒนา" }]);
}

async function handleDeleteTask(event, prompt) {
  const user_id = event.source.userId;
  const taskIdentifier = await extractDetailsWithAI(prompt, 'delete_task');
  
  // Find the task to delete and get its ID
  // ... This logic would need to be implemented
  // deleteDoc(docRef);
  
  await sendReplyMessage(event.replyToken, [{ type: "text", text: "ฟังก์ชันการลบงานยังอยู่ระหว่างการพัฒนา" }]);
}

async function handleCompleteTask(event, prompt) {
  const user_id = event.source.userId;
  const taskIdentifier = await extractDetailsWithAI(prompt, 'complete_task');
  
  // Find the task and get its ID
  // ... This logic would need to be implemented
  // updateDoc(docRef, { status: "Completed" });
  
  await sendReplyMessage(event.replyToken, [{ type: "text", text: "ฟังก์ชันการทำเครื่องหมายว่างานเสร็จสิ้นยังอยู่ระหว่างการพัฒนา" }]);
}

async function handleHealthQuery(event, prompt) {
  const healthResponse = await extractDetailsWithAI(prompt, 'health_query');
  const replyText = healthResponse;
  await sendReplyMessage(event.replyToken, [{ type: "text", text: replyText }]);
}

async function handleWeatherCheck(event, prompt) {
  const location = await extractDetailsWithAI(prompt, 'weather_check');
  if (!location) {
    await sendReplyMessage(event.replyToken, [{ type: "text", text: "กรุณาระบุสถานที่ที่ต้องการตรวจสอบสภาพอากาศ" }]);
    return;
  }
  
  const API_KEY = process.env.OPENWEATHER_API_KEY;
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&appid=${API_KEY}&units=metric&lang=th`;
  
  const fetch = (await import("node-fetch")).default;
  const response = await fetch(url);
  const weatherData = await response.json();
  
  if (response.ok) {
    const weatherDescription = weatherData.weather[0].description;
    const temp = weatherData.main.temp;
    const feelsLike = weatherData.main.feels_like;
    const humidity = weatherData.main.humidity;
    
    const replyText = `สภาพอากาศที่ ${location} ตอนนี้:
    - อุณหภูมิ: ${temp}°C (รู้สึกเหมือน ${feelsLike}°C)
    - สภาพอากาศ: ${weatherDescription}
    - ความชื้น: ${humidity}%`;
    
    await sendReplyMessage(event.replyToken, [{ type: "text", text: replyText }]);
  } else {
    await sendReplyMessage(event.replyToken, [{ type: "text", text: `ขออภัย ไม่พบข้อมูลสภาพอากาศสำหรับ ${location}` }]);
  }
}

async function handleGeneralKnowledge(event, prompt) {
  const knowledgeResponse = await extractDetailsWithAI(prompt, 'general_search');
  const replyText = knowledgeResponse;
  await sendReplyMessage(event.replyToken, [{ type: "text", text: replyText }]);
}

async function handleContentDrafting(event, prompt) {
  const draftedContent = await extractDetailsWithAI(prompt, 'create_content');
  const replyMessage = {
    type: "text",
    text: `นี่คือฉบับร่างของคุณ:\n\n${draftedContent}`,
  };
  await sendReplyMessage(event.replyToken, [replyMessage]);
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

      await sendReplyMessage(event.replyToken, [{
        type: "flex",
        altText: "งานถูกอัปเดตเป็นเสร็จแล้วเรียบร้อย",
        contents: {
          type: "bubble",
          header: {
            type: "box",
            layout: "vertical",
            contents: [
              { type: "text", text: "งานเสร็จเรียบร้อยแล้ว!", weight: "bold", color: "#ffffff", size: "lg", align: "center" },
            ],
            backgroundColor: "#10b981",
            paddingAll: "20px",
          },
          body: {
            type: "box",
            layout: "vertical",
            contents: [
              { type: "box", layout: "vertical", margin: "md", spacing: "sm", contents: [
                { type: "box", layout: "baseline", spacing: "sm", contents: [
                  { type: "text", text: "📋 ชื่องาน:", color: "#aaaaaa", size: "sm", flex: 2, },
                  { type: "text", text: taskData.title || "ไม่ระบุชื่อ", wrap: true, size: "sm", flex: 5, },
                ], },
                { type: "box", layout: "baseline", spacing: "sm", contents: [
                  { type: "text", text: "✅ สถานะ:", color: "#aaaaaa", size: "sm", flex: 2, },
                  { type: "text", text: "งานเสร็จสิ้นแล้ว", wrap: true, size: "sm", flex: 5, color: "#059669", },
                ], },
              ], },
            ],
            paddingAll: "20px",
          },
          styles: { body: { backgroundColor: "#F0F9F3" } },
        },
      }]);
      console.log(`[${getTimestamp()}] 🔥 Postback complete_task processed: ${taskId}`);
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
        if (!messageText.startsWith("alin") && !messageText.startsWith("อลิน")) {
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
            await handleCreateTask(event, aiPrompt);
            break;
          case 'read_task':
            await handleReadTask(event, aiPrompt);
            break;
          case 'edit_task':
            await handleEditTask(event, aiPrompt);
            break;
          case 'delete_task':
            await handleDeleteTask(event, aiPrompt);
            break;
          case 'complete_task':
            await handleCompleteTask(event, aiPrompt);
            break;
          case 'health_query':
            await handleHealthQuery(event, aiPrompt);
            break;
          case 'weather_check':
            await handleWeatherCheck(event, aiPrompt);
            break;
          case 'general_search':
            await handleGeneralKnowledge(event, aiPrompt);
            break;
          case 'create_content':
            await handleContentDrafting(event, aiPrompt);
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

process.on("SIGINT", () => {
  console.log(`\n[${getTimestamp()}] 🛑 Received shutdown signal - Gracefully shutting down webhook server...`);
  process.exit(0);
});

module.exports = app;