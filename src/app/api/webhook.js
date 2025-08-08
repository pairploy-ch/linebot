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

const LINE_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

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

      console.log(
        `[${getTimestamp()}] ✅ Task "${taskData.title}" marked as Completed and repeat stopped`
      );

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  console.log(`[${getTimestamp()}] 📩 Webhook received!`);
  console.log(`[${getTimestamp()}] 🔍 Headers:`, JSON.stringify(req.headers, null, 2));
  console.log(`[${getTimestamp()}] 📦 Body:`, JSON.stringify(req.body, null, 2));

  const events = req.body.events || [];

  if (events.length === 0) {
    console.log(`[${getTimestamp()}] ℹ️ No events to process`);
    return res.status(200).send("OK");
  }


  await Promise.all(
    events.map(async (event, index) => {
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
          await handleMessage(event);
        } else if (event.type === "postback") {
          await handlePostback(event);
        } else if (event.type === "follow") {
          console.log(`[${getTimestamp()}] 👋 User followed the bot: ${event.source?.userId}`);
        } else if (event.type === "unfollow") {
          console.log(`[${getTimestamp()}] 👋 User unfollowed the bot: ${event.source?.userId}`);
        } else {
          console.log(`[${getTimestamp()}] ℹ️ Unhandled event type: ${event.type}`);
        }

        console.log(
          `[${getTimestamp()}] ✅ Completed processing event ${index + 1}/${events.length}`
        );
      } catch (error) {
        console.error(`[${getTimestamp()}] ❌ Error processing event ${index + 1}/${events.length}:`, error);
        console.error(`[${getTimestamp()}] ❌ Event data:`, JSON.stringify(event, null, 2));
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
            console.error(`[${getTimestamp()}] ❌ Failed to send error notification:`, replyError);
          }
        }
      }
    })
  );

  console.log(`[${getTimestamp()}] 🏁 Finished processing all ${events.length} events`);

  return res.status(200).send("OK");
}
