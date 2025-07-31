import { onSchedule } from "firebase-functions/v2/scheduler";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import axios from "axios";

initializeApp();
const db = getFirestore();

export const cronCheckTasks = onSchedule("every 1 minutes", async () => {
  const now = new Date();
  const currentDate = now.toISOString().split("T")[0]; // YYYY-MM-DD
  const currentTime = now.toTimeString().split(" ")[0].substring(0, 5); // HH:mm

  const snapshot = await db.collection("tasks").get();

  for (const doc of snapshot.docs) {
    const task = doc.data();
    if (
      task.date === currentDate &&
      task.time?.startsWith(currentTime) &&
      task.lineUserId &&
      !task.notified
    ) {
      // ส่งแจ้งเตือน LINE
      await sendLineMessage(task.lineUserId, `🔔 ถึงเวลา: ${task.title}`);
      await doc.ref.update({ notified: true });
    }
  }
});

async function sendLineMessage(lineUserId, message) {
  const payload = {
    to: lineUserId,
    messages: [
      {
        type: "text",
        text: message,
      },
    ],
  };

  await axios.post("https://api.line.me/v2/bot/message/push", payload, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
  });
}
