const express = require("express");
const admin = require("firebase-admin");
const moment = require("moment-timezone");
const openai = require("openai");
const { default: fetch } = require("node-fetch");
const { Timestamp, FieldValue } = require('firebase-admin/firestore');

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

// Reference to the metrics document for counters
const metricsDocRef = db.collection('metrics').doc('summary');

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
    - create_task: User write a certain thing which seems to be a task or thing user is to do
    - summarize_task: User wants to know, summarize or list tasks within a specific date range (maybe no obvious word)
    - general_search: User is asking a general knowledge question or for a summary.
    - create_content: User wants to draft an email, social media post, script, or other text.
    - unknown: The intent does not match any of the above categories.


    User message: "${prompt}"
    Your response (single category code only):
  `;

  const response = await openaiClient.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: classificationPrompt }],
    max_tokens: 10,
    temperature: 0,
  });

  const category = response.choices[0].message.content.trim();
  console.log(`[${getTimestamp()}] 🤖 AI Classified intent: ${category}`);
  return category;
}

function formatDateInThai(date) {
  return date.toLocaleDateString("th-TH", {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

async function summarizeDateRangeWithAI(prompt) {
  const now = moment().tz("Asia/Bangkok");
  const currentDate = now.format("dddd DD/MM/YYYY HH.mm");

  const analyzeRangePrompt = `
รับคำสั่งสรุป "ช่วงวันที่" แล้วตอบเป็น JSON เท่านั้น (ห้ามมีคำอธิบายอื่น)

สกีมา:
{
  "start_date": "YYYY, M, D, 00, 00, 00, 00000",
  "end_date":   "YYYY, M, D, 23, 59, 59, 99999",
  "range_type": <1 | 2>
}

เงื่อนไขและกติกา:
- today date is ${currentDate} (โซนเวลา Asia/Bangkok)
- ถ้าระบุวันเดียว (single day) ให้:
  - range_type = 1
- ถ้าเป็นช่วงหลายวัน (multiple days) ให้:
  - range_type = 2
- ถ้าให้ชื่อเดือน/สัปดาห์โดยไม่ระบุวัน ให้ตีความเป็นช่วงทั้งหมดของหน่วยนั้น:
  - เดือน: จากวันแรกของเดือนนี้ถึงวันสุดท้ายของเดือนนี้
  - สัปดาห์: ให้เริ่มจากวันนี้ และไปสิ้นสุดภายใน 7 วัน (รวมวันเริ่มต้น)
- ถ้าไม่พบวันที่จากข้อความ ให้ตอบ:
  {
    "error": "date"
  }
- ห้ามมีฟิลด์อื่นนอกเหนือจากที่กำหนด

ผู้ใช้: "${prompt}"
`;

  const response = await openaiClient.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: analyzeRangePrompt }],
    max_tokens: 200,
    temperature: 0,
  });

  const range_analysis = response.choices[0].message.content.trim();
  console.log(`[${getTimestamp()}] 🤖 AI Date Range Analysis: ${range_analysis}`);
  return JSON.parse(range_analysis);
}

async function createTaskWithAI(prompt) {
  const now = moment().tz("Asia/Bangkok");
  const currentDate = now.format("dddd DD/MM/YYYY HH.mm")
  const analyzeCreateTaskPrompt = `
        รับคำสั่งสร้าง reminder แปลงเป็น JSON

    {
      "intent": "add_reminder",
      "task": "<สิ่งที่ต้องทำ>", (ไม่เกิน 8 คำ)
      "time": "<HH:MM>",
      "date": "<YYYY-MM-DD>",
      "repeat": "<once | daily | weekly | monthly | yearly>",
      "endDate": "<YYYY-MM-DD>"
    }

    กติกา:
    - today date is ${currentDate}
    - “พรุ่งนี้”, “วันนี้” → แปลงเป็นวันที่จริง 
    - “ทุกวัน/พุธ” → set repeat ให้ตรง
    - ถ้าไม่มีคำซ้ำ → repeat = once
    - **ถ้า repeat ไม่ใช่ once และไม่มีการระบุ endDate ให้ตั้งค่า endDate เป็น 30 วันนับจาก date ที่เริ่ม**
    ตอบกลับเป็น JSON เท่านั้น ห้ามมีคำอธิบาย

    ถ้าไม่มี task ให้เขียนส่งเป็นไฟล์ json
    {
    "error" : "title" 
    }

    กรณีไม่บอกวันที่และเวลา: ถ้าตอนนี้ยังไม่เกิน 12.00 เที่ยงวัน ให้ตั้งเป็นวันนี้ 18.00 ถ้าเลยเที่ยงวันแล้ว ให้ตั้งเป็นพรุ่งนี้ 8.00 
    ถ้าบอกเวลา แต่ไม่บอกวันที่ : ถ้าเลยเวลาปัจจุบัน ให้ตั้งเป็นวันถัดไป แต่ถ้ายังไม่เลยเวลาปัจจุบัน ให้ตั้งเป็นวันนี้
    ถ้าบอกวันที่ แต่ไม่บอกเวลา : time = 8.00 (ยกเว้นถ้าวันนี้เลย 8.00 แล้ว ให้ตั้งเป็น 18.00, ถ้าเลย 18.00 ให้ตั้งเป็น 8.00 ของวันถัดไป)


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

async function contentWithAI(prompt) {
  const createContentPrompt = `
      ช่วย user เขียนข้อความสั้นๆ ที่เกี่ยวกับการสร้างเนื้อหา เช่น อีเมล โพสต์โซเชียลมีเดีย หรือสคริปต์ หรืออื่นๆตามที่ต้องการ
      
    User message: "${prompt}"
  `;


  const response = await openaiClient.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: createContentPrompt }],
    max_tokens: 600,
    temperature: 0,
  });

  const text_file_analysis = response.choices[0].message.content.trim();
  console.log(`[${getTimestamp()}] 🤖 AI Content Generation: ${text_file_analysis}`);
  return text_file_analysis;
}

// =================================================================================================
// DETAILED LOGGING ADDED TO THIS FUNCTION
// =================================================================================================
const calculateNotificationDates = (startDate, time, repeat, endDate) => {
  console.log(`[DEBUG] --------------------------------------------------`);
  console.log(`[DEBUG] 🔍 ENTERING calculateNotificationDates`);
  console.log(`[DEBUG] --------------------------------------------------`);
  console.log(`[DEBUG] |--> Initial Parameters Received:`);
  console.log(`[DEBUG] |    - startDate: ${startDate} (Type: ${typeof startDate})`);
  console.log(`[DEBUG] |    - time:      ${time} (Type: ${typeof time})`);
  console.log(`[DEBUG] |    - repeat:    ${repeat} (Type: ${typeof repeat})`);
  console.log(`[DEBUG] |    - endDate:   ${endDate} (Type: ${typeof endDate})`);

  const dates = [];
  const startYear = parseInt(startDate.substring(0, 4), 10);
  const gregorianYear = startYear > 2500 ? startYear - 543 : startYear;
  const gregorianStartDate = `${gregorianYear}${startDate.substring(4)}`;
  console.log(`[DEBUG] |--> Date Conversion: Converted Buddhist year start date to Gregorian: ${gregorianStartDate}`);

  let currentDate = moment.tz(`${gregorianStartDate}T${time}`, "Asia/Bangkok");
  if (!currentDate.isValid()) {
    console.error(`[DEBUG] |--> 🚨 INVALID MOMENT DATE CREATED! Check startDate and time format.`);
    return [];
  }
  console.log(`[DEBUG] |--> Moment.js Object 'currentDate' created: ${currentDate.format()}`);

  const end = repeat === "Never" || !endDate
    ? currentDate.clone()
    : moment.tz(`${endDate}T23:59:59`, "Asia/Bangkok");
  if (!end.isValid()) {
    console.error(`[DEBUG] |--> 🚨 INVALID MOMENT END DATE CREATED! Check endDate format.`);
    return dates; // Return what we have so far
  }
  console.log(`[DEBUG] |--> Moment.js Object 'end' created: ${end.format()}`);
  console.log(`[DEBUG] --------------------------------------------------`);
  console.log(`[DEBUG] 🔄 Starting Notification Calculation Loop...`);

  let loopCount = 0;
  while (currentDate.isSameOrBefore(end)) {
    loopCount++;
    console.log(`[DEBUG] |`);
    console.log(`[DEBUG] |--- Loop Iteration #${loopCount} ---`);
    console.log(`[DEBUG] |    Condition Met: ${currentDate.format()} is same or before ${end.format()}`);
    dates.push(currentDate.toDate());
    console.log(`[DEBUG] |    ✅ Pushed date to array. Array size is now: ${dates.length}`);

    if (repeat === "Daily") {
      console.log(`[DEBUG] |    Repeat is 'Daily'. Adding 1 day.`);
      currentDate.add(1, "day");
    } else if (repeat === "Weekly") {
      console.log(`[DEBUG] |    Repeat is 'Weekly'. Adding 1 week.`);
      currentDate.add(1, "week");
    } else if (repeat === "Monthly") {
      console.log(`[DEBUG] |    Repeat is 'Monthly'. Adding 1 month.`);
      currentDate.add(1, "month");
    } else if (repeat === "Yearly") {
      console.log(`[DEBUG] |    Repeat is 'Yearly'. Adding 1 year.`);
      currentDate.add(1, "year");
    } else {
      console.log(`[DEBUG] |    Repeat is '${repeat}'. No condition met. Breaking loop.`);
      break;
    }
    console.log(`[DEBUG] |    New 'currentDate' for next loop: ${currentDate.format()}`);
  }

  if (loopCount === 0) {
    console.log(`[DEBUG] |--> ⚠️ Loop condition 'currentDate.isSameOrBefore(end)' was false on the first check. Loop did not run.`);
  }

  console.log(`[DEBUG] --------------------------------------------------`);
  console.log(`[DEBUG] ✅ Loop Finished. Total notifications generated: ${dates.length}`);
  console.log(`[DEBUG] 🚀 EXITING calculateNotificationDates`);
  console.log(`[DEBUG] --------------------------------------------------`);
  return dates;
};


// =================================================================================================
// DETAILED LOGGING ADDED TO THIS FUNCTION
// =================================================================================================
async function handleAddTaskServer(taskData, lineUserId, userName) {
  console.log(`[DEBUG] ==================================================`);
  console.log(`[DEBUG] 📥 ENTERING handleAddTaskServer`);
  console.log(`[DEBUG] ==================================================`);
  console.log(`[DEBUG] |--> Task data received for user ${lineUserId}:`);
  console.log(JSON.stringify(taskData, null, 2));

  try {
    const userDocRef = db.collection("users").doc(lineUserId);
    await userDocRef.set({
      name: userName,
      lineUserId: lineUserId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`[DEBUG] |--> User document ensured in Firestore.`);

    const userTasksCollectionRef = userDocRef.collection("tasks");
    const masterTask = {
      title: taskData.title,
      detail: taskData.detail || "",
      repeatType: taskData.repeat,
      startDate: taskData.date,
      endDate: taskData.endDate || taskData.date,
      userId: lineUserId,
      userName: userName,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    const docRef = await userTasksCollectionRef.add(masterTask);
    console.log(`[${getTimestamp()}] ✅ Parent task document created with ID: ${docRef.id}`);
    console.log(`[DEBUG] |--> Master task data written to Firestore. Repeat type is '${masterTask.repeatType}'.`);

    console.log(`[DEBUG] |--> 📞 Calling calculateNotificationDates with repeat='${taskData.repeat}' and endDate='${taskData.endDate}'...`);
    const notificationDates = calculateNotificationDates(
      taskData.date,
      taskData.time,
      taskData.repeat,
      taskData.endDate
    );
    console.log(`[DEBUG] |--> 📬 Got ${notificationDates.length} dates back from calculateNotificationDates.`);

    if (notificationDates.length > 0) {
        metricsDocRef.update({
        notifications_expected: FieldValue.increment(notificationDates.length)
        }).catch(error => console.error("Error updating metrics:", error));

        const notificationsCollectionRef = docRef.collection("notifications");
        const batch = db.batch();
        notificationDates.forEach(date => {
            const newNotifRef = notificationsCollectionRef.doc();
            batch.set(newNotifRef, {
                notificationTime: Timestamp.fromDate(date),
                status: "Upcoming",
                notified: false,
                userId: lineUserId,
            });
        });
        await batch.commit();
        console.log(`[DEBUG] |--> Successfully committed a batch of ${notificationDates.length} notifications to Firestore.`);
    } else {
        console.log(`[DEBUG] |--> ⚠️ No notification dates were generated, so no notifications were written to the database.`);
    }

    console.log(`[${getTimestamp()}] ✅ ${notificationDates.length} notification(s) created.`);
    console.log(`[DEBUG] ==================================================`);
    console.log(`[DEBUG] ✅ EXITING handleAddTaskServer (SUCCESS)`);
    console.log(`[DEBUG] ==================================================`);
    return { success: true, taskId: docRef.id };
  } catch (error) {
    console.error(`[${getTimestamp()}] ❌ Failed to add task:`, error);
    console.log(`[DEBUG] ==================================================`);
    console.log(`[DEBUG] ❌ EXITING handleAddTaskServer (ERROR)`);
    console.log(`[DEBUG] ==================================================`);
    return { success: false, error: error.message };
  }
}

async function generalSearchWithAI(prompt) {
  const generalSearchPrompt = `
    Answer the following general knowledge question concisely .
    User message: "${prompt}"
  `;
  const response = await openaiClient.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: generalSearchPrompt }],
    max_tokens: 200,
    temperature: 0,
  });
  const aiAnswer = response.choices[0].message.content.trim();
  console.log(`[${getTimestamp()}] 🤖 AI answer general knowledge question: ${aiAnswer}`);
  return aiAnswer;
}


async function healthWithAI(prompt) {
  const healthPrompt = `
    Answer, Suggest, or Comment the following health question or message concisely .
    User message: "${prompt}"
  `;
  const response = await openaiClient.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: healthPrompt }],
    max_tokens: 200,
    temperature: 0,
  });
  const aiAnswer = response.choices[0].message.content.trim();
  console.log(`[${getTimestamp()}] 🤖 AI answer health message: ${aiAnswer}`);
  return aiAnswer;
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
        text: `งาน "${parentTaskData.title}" เสร็จสิ้นแล้ว`
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
  metricsDocRef.update({
    messages_received: FieldValue.increment(1)
  }).catch(error => console.error("Error updating messages_received metrics:", error));

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
          return;
        }

        metricsDocRef.update({
          messages_to_ai: FieldValue.increment(1)
        }).catch(error => console.error("Error updating messages_to_ai metrics:", error));

        const aiPrompt = messageText.substring(messageText.indexOf(" ") + 1);
        const characterThreshold = 500;
        if (aiPrompt.length > characterThreshold) {
          const replyMessage = { type: "text", text: "ข้อความของคุณยาวเกินไป กรุณาพิมพ์ให้กระชับยิ่งขึ้น" };
          await sendReplyMessage(event.replyToken, [replyMessage]);
          return;
        }

        const intent = await classifyMessageWithAI(aiPrompt);

        const updateObject = {};
        updateObject[`intent_categorized_${intent}`] = FieldValue.increment(1);
        metricsDocRef.update(updateObject).catch(error => console.error("Error updating intent metrics:", error));

        if (intent === 'create_task') {
          const aiOutputJson = await createTaskWithAI(aiPrompt);
          try {
            // =================================================================================================
            // DETAILED LOGGING ADDED HERE
            // =================================================================================================
            console.log(`[DEBUG] #################################################`);
            console.log(`[DEBUG] ### STARTING 'create_task' INTENT PROCESS ###`);
            console.log(`[DEBUG] #################################################`);
            console.log(`[DEBUG] 1. Raw JSON string from AI:\n${aiOutputJson}`);
            
            const cleanJsonString = aiOutputJson.replace(/```json|```/g, '').trim();
            const aiTaskData = JSON.parse(cleanJsonString);
            console.log(`[DEBUG] 2. Parsed aiTaskData object:`);
            console.log(JSON.stringify(aiTaskData, null, 2));

            const repeatValue = aiTaskData.repeat;
            console.log(`[DEBUG] 3. Extracted 'repeat' value from AI object: '${repeatValue}'`);

            const formattedRepeat = repeatValue === 'once'
              ? 'Never'
              : repeatValue.charAt(0).toUpperCase() + repeatValue.slice(1);
            console.log(`[DEBUG] 4. Formatted 'repeat' value for logic: '${formattedRepeat}'`);

            const taskDataToCreate = {
              title: aiTaskData.task,
              detail: "",
              date: aiTaskData.date,
              time: aiTaskData.time,
              repeat: formattedRepeat,
              endDate: aiTaskData.endDate || aiTaskData.date,
              color: "blue",
              status: "Upcoming",
            };
            console.log(`[DEBUG] 5. Final 'taskDataToCreate' object before passing to server function:`);
            console.log(JSON.stringify(taskDataToCreate, null, 2));
            console.log(`[DEBUG]    CHECK -> Is endDate present and correct? -> ${taskDataToCreate.endDate}`);
            console.log(`[DEBUG] #################################################`);

            const result = await handleAddTaskServer(taskDataToCreate, event.source.userId, event.source.displayName || "LINE User");

            if (result.success) {
              const taskDate = new Date(`${taskDataToCreate.date}T${taskDataToCreate.time}`);
              const formattedDateWithWeekday = taskDate.toLocaleDateString("th-TH", {
                weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
              });
              const replyMessage = {
                type: "text",
                text: `สร้างการแจ้งเตือน "${taskDataToCreate.title}"  ${formattedDateWithWeekday} เวลา ${taskDataToCreate.time}.`
              };
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
        else if (intent === 'summarize_task') {
          const aiResult = await summarizeDateRangeWithAI(aiPrompt);

          if (aiResult.error) {
            console.log(`❌ AI could not parse the date range. Error: ${aiResult.error}`);
            const replyMessage = { type: "text", text: `ขออภัยค่ะ ฉันไม่เข้าใจช่วงวันที่ที่คุณต้องการให้สรุป` };
            await sendReplyMessage(event.replyToken, [replyMessage]);
            return;
          }

          const [startYear, startMonth, startDay, startHour, startMinute, startSecond, startMilli] = aiResult.start_date.split(',').map(arg => parseInt(arg.trim()));
          const [endYear, endMonth, endDay, endHour, endMinute, endSecond, endMilli] = aiResult.end_date.split(',').map(arg => parseInt(arg.trim()));

          const startDate = new Date(startYear, startMonth - 1, startDay, startHour, startMinute, startSecond, startMilli);
          const endDate = new Date(endYear, endMonth - 1, endDay, endHour, endMinute, endSecond, endMilli);

          const targetUserId = event.source.userId;

          let allNotifications = [];
          const tasksRef = db.collection('users').doc(targetUserId).collection('tasks');
          const tasksSnapshot = await tasksRef.get();

          if (tasksSnapshot.empty) {
            const replyMessage = { type: "text", text: `ไม่พบงานในระบบของคุณค่ะ` };
            await sendReplyMessage(event.replyToken, [replyMessage]);
            return;
          }

          const notificationQueries = tasksSnapshot.docs.map(async (taskDoc) => {
            const notificationsRef = taskDoc.ref.collection('notifications');
            const notificationsQuery = notificationsRef
              .where('notificationTime', '>=', startDate)
              .where('notificationTime', '<=', endDate)
              .where('status', '!=', 'Completed');
            const notificationsSnapshot = await notificationsQuery.get();

            notificationsSnapshot.forEach(async (notiDoc) => {
              const parentTaskData = taskDoc.data();
              allNotifications.push({
                ...notiDoc.data(),
                parentTaskTitle: parentTaskData.title || 'N/A',
                id: notiDoc.id
              });
            });
          });

          await Promise.all(notificationQueries);
          allNotifications.sort((a, b) => a.notificationTime.toDate() - b.notificationTime.toDate());

          let message;
          if (allNotifications.length > 0) {
            if (aiResult.range_type === 1) {
              const singleDateName = startDate.toLocaleDateString("th-TH", {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              });
              message = `ใน${singleDateName} คุณมีทั้งหมด ${allNotifications.length} งาน\n\n`;
            } else {
              const startMonthName = startDate.toLocaleDateString("th-TH", { month: 'long' });
              const endMonthName = endDate.toLocaleDateString("th-TH", { month: 'long' });
              message = `ในระหว่างวันที่ ${startDate.getDate()} ${startMonthName} ถึง วันที่ ${endDate.getDate()} ${endMonthName} คุณมีทั้งหมด ${allNotifications.length} งาน\n\n`;
            }

            allNotifications.forEach((noti, i) => {
              const notificationDate = noti.notificationTime.toDate();
              const formattedDate = notificationDate.toLocaleDateString("th-TH", {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              });

              let dateString;
              if (aiResult.range_type === 1) {
                const timePart = `${String(notificationDate.getHours()).padStart(2, '0')}:${String(notificationDate.getMinutes()).padStart(2, '0')}`;
                dateString = `${formattedDate} เวลา ${timePart}`;
              } else {
                dateString = formattedDate;
              }

              message += `${i + 1}. ${noti.parentTaskTitle} : ${dateString}\n`;
            });
          } else {
            message = `ไม่พบงานในช่วงเวลาที่คุณระบุค่ะ`;
          }

          const replyMessage = { type: "text", text: message };
          await sendReplyMessage(event.replyToken, [replyMessage]);
        }

        else if (intent === 'general_search') {
          const aiOutputGeneralSearch = await generalSearchWithAI(aiPrompt);
          const replyMessage = { type: "text", text: `${aiOutputGeneralSearch}` };
          await sendReplyMessage(event.replyToken, [replyMessage]);
        }

        else if (intent === 'health_query') {
          const aiOutputhealth = await healthWithAI(aiPrompt);
          const replyMessage = { type: "text", text: `${aiOutputhealth}` };
          await sendReplyMessage(event.replyToken, [replyMessage]);
        }

        else if (intent === 'create_content') {
          const aiOutputContent = await contentWithAI(aiPrompt);
          const replyMessage = { type: "text", text: `${aiOutputContent}` };
          await sendReplyMessage(event.replyToken, [replyMessage]);
        }


        else {
          const replyMessage = { type: "text", text: "Alin ขอโทษค่ะ Alin ไม่สามารถเข้าใจคำสั่งนี้ได้ รบwกวนพิมพ์มาใหม่อีกรอบนะคะ" };
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
  console.log(`[${getTimestamp()}] ❤️  Health check: http://localhost:${port}/health`);
  console.log(`[${getTimestamp()}] 🎯 Ready to handle task completion actions!`);
});

module.exports = app;
