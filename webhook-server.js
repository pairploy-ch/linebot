const express = require("express");

const admin = require("firebase-admin");

const moment = require("moment-timezone");

const openai = require("openai");

const { default: fetch } = require("node-fetch");

const { Timestamp } = require('firebase-admin/firestore');



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

    - create_task: User wants to create a new task or reminder (if it is work, it is; may be no obvious words indicated the desire to create task).

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
  console.log(`[${getTimestamp()}] 🤖 AI Classified intent: ${category}`)
  return category;

}



async function createTaskWithAI(prompt) {
  const now = moment().tz("Asia/Bangkok");
  const currentDate = now.format("dddd DD/MM/YYYY HH.mm");

  const analyzeCreateTaskPrompt = `

        รับคำสั่งสร้าง reminder แปลงเป็น JSON



    {

      "intent": "add_reminder",

      "task": "<สิ่งที่ต้องทำ>", (ไม่เกิน 5 คำ)

      "time": "<HH:MM>",

      "date": "<YYYY-MM-DD>",

      "repeat": "<once | daily | weekly | monthly | yearly>"

    }



    กติกา:
- today date is ${currentDate}

    - “พรุ่งนี้”, “วันนี้” → แปลงเป็นวันที่จริง 

    - “ทุกวัน/พุธ” → set repeat ให้ตรง

    - ไม่มีคำซ้ำ → repeat = once

    ตอบกลับเป็น JSON เท่านั้น ห้ามมีคำอธิบาย



    ถ้าไม่มี task ให้เขียนส่งเป็นไฟล์ json

    {

    "error" : "title"

    }



    ถ้าไม่มีเวลาบอก > 8.00

    ถ้าไม่มีวันที่บอก > วันนี้



    User message: "${prompt}"

  `;





  const response = await openaiClient.chat.completions.create({

    model: "gpt-4o-mini",

    messages: [{ role: "user", content: analyzeCreateTaskPrompt }],

    max_tokens: 200,

    temperature: 0,

  });



  const text_file_analysis = response.choices[0].message.content.trim();

  console.log(`[${getTimestamp()}] 🤖 AI Create Task Analysis: ${text_file_analysis}`);

  return text_file_analysis;

}





// New server-side task creation function, adapted from page.js

async function handleAddTaskServer(taskData, lineUserId, userName) {

  console.log(`[${getTimestamp()}] 📝 Starting task creation for user: ${lineUserId}`);

  try {

    // Step 1: Ensure a user document exists for the current user

    const userDocRef = db.collection("users").doc(lineUserId);

    await userDocRef.set({

      name: userName,

      lineUserId: lineUserId,

      createdAt: admin.firestore.FieldValue.serverTimestamp(),

    }, { merge: true });

    console.log(`[${getTimestamp()}] ✅ User document ensured.`);



    // Step 2: Create the master task document within the user's subcollection

    const userTasksCollectionRef = userDocRef.collection("tasks");

    const masterTask = {

      title: taskData.title,

      detail: taskData.detail || "", // Use empty string if not provided

      repeatType: taskData.repeat,

      startDate: taskData.date,

      endDate: taskData.endDate || taskData.date, // Use start date if end date is not provided

      userId: lineUserId,

      userName: userName,

      createdAt: admin.firestore.FieldValue.serverTimestamp(),

    };

    // FIX: Use the add() method on the collection reference

    const docRef = await userTasksCollectionRef.add(masterTask);

    console.log(`[${getTimestamp()}] ✅ Parent task document created with ID: ${docRef.id}`);



    // Step 3: Calculate and create notifications as a subcollection

    const calculateNotificationDates = (startDate, time, repeat, endDate) => {

      const dates = [];

      // FIX: Handle Thai Buddhist year (B.E.) to Gregorian year (A.D.) conversion

      const startYear = parseInt(startDate.substring(0, 4), 10);

      const gregorianYear = startYear > 2500 ? startYear - 543 : startYear;

      const gregorianStartDate = `${gregorianYear}${startDate.substring(4)}`;



      let currentDate = moment.tz(`${gregorianStartDate}T${time}`, "Asia/Bangkok");



      const endYear = parseInt(endDate.substring(0, 4), 10);

      const gregorianEndYear = endYear > 2500 ? endYear - 543 : endYear;

      const gregorianEndDate = `${gregorianEndYear}${endDate.substring(4)}`;



      const end = repeat === "Never" ? currentDate.clone() : moment.tz(`${gregorianEndDate}T23:59:59`, "Asia/Bangkok");



      while (currentDate.isSameOrBefore(end)) {

        dates.push(currentDate.toDate());

        if (repeat === "Daily") currentDate.add(1, "day");

        else if (repeat === "Weekly") currentDate.add(1, "week");

        else if (repeat === "Monthly") currentDate.add(1, "month");

        else break; // For 'Never' repeat type

      }

      return dates;

    };



    const notificationDates = calculateNotificationDates(

      taskData.date,

      taskData.time,

      taskData.repeat,

      taskData.endDate

    );



    // FIX: Get the collection reference directly from the document reference

    const notificationsCollectionRef = docRef.collection("notifications");

    for (const date of notificationDates) {

      await notificationsCollectionRef.add({

        notificationTime: Timestamp.fromDate(date),

        status: "Upcoming",

        notified: false,

        userId: lineUserId,

      });

    }

    console.log(`[${getTimestamp()}] ✅ ${notificationDates.length} notification(s) created.`);



    return { success: true, taskId: docRef.id };

  } catch (error) {

    console.error(`[${getTimestamp()}] ❌ Failed to add task:`, error);

    return { success: false, error: error.message };

  }

}



async function handlePostback(event) {

  const data = event.postback?.data;

  const userId = event.source?.userId;



  if (!data || !userId) return;



  if (data.startsWith("complete_task_")) {

    const parts = data.split('_');

    if (parts.length < 8) {

      console.error(`[${getTimestamp()}] ❌ Invalid postback data format: ${data}`);

      await sendReplyMessage(event.replyToken, [{ type: "text", text: "❌ เกิดข้อผิดพลาดในการประมวลผลข้อมูล กรุณาลองใหม่" }]);

      return;

    }

    const parentTaskId = parts[5];

    const notificationId = parts[7];



    try {

      const notificationRef = db.collection("users").doc(userId).collection("tasks").doc(parentTaskId).collection("notifications").doc(notificationId);

      const notificationDoc = await notificationRef.get();



      if (!notificationDoc.exists) {

        await sendReplyMessage(event.replyToken, [{ type: "text", text: "❌ ไม่พบการแจ้งเตือนที่ระบุในระบบ" }]);

        return;

      }



      const parentTaskRef = notificationDoc.ref.parent.parent;

      const parentTaskDoc = await parentTaskRef.get();

      const parentTaskData = parentTaskDoc.data();



      if (parentTaskData.userId !== userId) {

        await sendReplyMessage(event.replyToken, [{ type: "text", text: "❌ คุณไม่มีสิทธิ์ในการอัปเดตงานนี้" }]);

        return;

      }



      await notificationRef.update({

        status: "Completed",

        completedAt: admin.firestore.FieldValue.serverTimestamp(),

      });



      console.log(`[${getTimestamp()}] ✅ Notification "${parentTaskData.title}" for task "${parentTaskId}" marked as Completed`);



      await sendReplyMessage(event.replyToken, [{

        type: "text",

        text: `✅ Task "${parentTaskData.title}" has been marked as completed.`

      }]);



      console.log(`[${getTimestamp()}] 🔥 Postback complete_task processed for notification: ${notificationId}`);

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



        if (intent === 'create_task') {

          const aiOutputJson = await createTaskWithAI(aiPrompt);

          try {

            // Fix: Strip markdown code block fences before parsing JSON

            const cleanJsonString = aiOutputJson.replace(/```json|```/g, '').trim();

            const aiTaskData = JSON.parse(cleanJsonString);



            // Map AI output to the expected task format

            const taskDataToCreate = {

              title: aiTaskData.task,

              detail: "",

              date: aiTaskData.date,

              time: aiTaskData.time,

              repeat: aiTaskData.repeat === 'once' ? 'Never' : aiTaskData.repeat,

              endDate: aiTaskData.endDate || aiTaskData.date,

              color: "blue",

              status: "Upcoming",

            };



            const result = await handleAddTaskServer(taskDataToCreate, event.source.userId, event.source.displayName || "LINE User");



            if (result.success) {

              const replyMessage = { type: "text", text: `✅ Task "${taskDataToCreate.title}" has been created.` };

              await sendReplyMessage(event.replyToken, [replyMessage]);

            } else {

              const replyMessage = { type: "text", text: "❌ Failed to create task. Please try again." };

              await sendReplyMessage(event.replyToken, [replyMessage]);

            }

          } catch (error) {

            console.error(`[${getTimestamp()}] ❌ Error parsing AI response or creating task:`, error);

            const replyMessage = { type: "text", text: "❌ เกิดข้อผิดพลาดในการสร้างงาน กรุณาลองใหม่" };

            await sendReplyMessage(event.replyToken, [replyMessage]);

          }

        }

        else {

          const replyMessage = { type: "text", text: `ประเภทข้อความที่ตรวจพบ: ${intent}` };

          await sendReplyMessage(event.replyToken, [replyMessage]);

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

  console.log(`[${getTimestamp()}] ❤️  Health check: http://localhost:${port}/health`);

  console.log(`[${getTimestamp()}] 🎯 Ready to handle task completion actions!`);

});



module.exports = app;