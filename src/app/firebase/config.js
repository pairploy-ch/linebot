import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAxjKinROCjy8QiUEWarSv21OMYn6g00aw",
  authDomain: "botyourassistant-33a1a.firebaseapp.com",
  projectId: "botyourassistant-33a1a",
  storageBucket: "botyourassistant-33a1a.firebasestorage.app",
  messagingSenderId: "259712597709",
  appId: "1:259712597709:web:62c67863fc421dafdc3384"
};


const app = initializeApp(firebaseConfig);


export const db = getFirestore(app);

export default app;