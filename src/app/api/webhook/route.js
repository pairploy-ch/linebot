import admin from "firebase-admin";

const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG_JSON);

serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');



if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });
}


const db = admin.firestore();

const LINE_ACCESS_TOKEN =
  "wE1+/bnCirraiwTKbLA5UvveJcCYLfulnlLy4FEU1wdk+8a5uNlc7fzYqK/mWayfFyo9EdmyiLvXLErHn+AWtS4zHib7InjUSx96viPy5FZ49S2uKktIGxZEiuQ1sx5xxLX2Wj9UWuhkbQg94XqGigdB04t89/1O/w1cDnyilFU=";

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

// ตัดฟังก์ชันอื่นๆ ที่ใช้ใน handlePostback มาใส่เหมือนเดิม
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
  }
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

export async function POST(request) {
  try {
    const body = await request.json();

    console.log(`[${getTimestamp()}] 📩 Webhook received!`);
    console.log(`[${getTimestamp()}] 🔍 Body:`, JSON.stringify(body, null, 2));

    const events = body.events || [];
    console.log(`[${getTimestamp()}] 📊 Number of events to process: ${events.length}`);

    for (const event of events) {
      console.log(`[${getTimestamp()}] 🔄 Processing event type: ${event.type}`);
      if (event.type === "message" && event.message?.type === "text") {
        await handleMessage(event);
      } else if (event.type === "postback") {
        await handlePostback(event);
      } else {
        console.log(`[${getTimestamp()}] ℹ️ Unhandled event type: ${event.type}`);
      }
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error(`[${getTimestamp()}] ❌ Error in webhook POST:`, error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
