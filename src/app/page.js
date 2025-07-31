"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import React, { useState, useEffect } from "react";
import {
  Home,
  Plus,
  Menu,
  Calendar,
  Clock,
  ChevronDown,
  X,
  Edit,
  Trash2,
} from "lucide-react";
import { Toaster, toast } from "react-hot-toast";

import {
  collection,
  addDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  orderBy,
  onSnapshot,
  Timestamp,
} from "firebase/firestore";
import { db } from "../app/firebase/config";

export default function TaskManager() {
  const { data: session } = useSession();
  const [activeTab, setActiveTab] = useState("Upcoming");
  const [currentView, setCurrentView] = useState("home");
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingTask, setEditingTask] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState(null);
  const [newTask, setNewTask] = useState({
    title: "",
    detail: "",
    date: "",
    time: "",
    repeat: "Never",
    color: "blue",
    status: "Upcoming",
  });

  //tabs
  const tabs = ["All", "Upcoming", "Completed", "Overdue"];

  const handleAddTask = async () => {
    if (!session?.lineUserId) {
      console.warn("No session or lineUserId");
      return;
    }

    if (!newTask.title.trim()) {
      toast.error("กรุณาใส่ชื่อ task");
      return;
    }

    try {
      const task = {
        title: newTask.title || null,
        detail: newTask.detail || null,
        repeat: newTask.repeat || null,
        status: newTask.status || null,
        date: formatDateTime(newTask.date, newTask.time) || null,
        userId: session.lineUserId,
        userName: session.user.name,
        createdAt: Timestamp.now(),
      };

      const docRef = await addDoc(collection(db, "tasks"), task);
      setCurrentView("home");
      setNewTask({
        title: "",
        detail: "",
        date: "",
        time: "",
        repeat: "Never",
        color: "blue",
        status: "Upcoming",
      });
      console.log("เพิ่ม task แล้ว:", docRef.id);
      toast.success("เพิ่ม task สำเร็จแล้ว!");
    } catch (error) {
      console.error("เพิ่ม task ล้มเหลว:", error);
      toast.error("เพิ่ม task ล้มเหลว");
    }
  };

  // Delete Modal Component
  const DeleteModal = () => {
    if (!showDeleteModal) return null;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl w-full max-w-sm mx-4 shadow-xl">
          <div className="p-6 text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-red-100 rounded-full flex items-center justify-center">
              <Trash2 className="w-8 h-8 text-red-500" />
            </div>
            
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              ลบ Task นี้?
            </h3>
            
            <p className="text-gray-600 text-sm mb-6">
              คุณแน่ใจหรือไม่ที่จะลบ task นี้?
            </p>
            
            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setTaskToDelete(null);
                }}
                className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-xl font-medium hover:bg-gray-200 transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={confirmDeleteTask}
                className="flex-1 bg-red-500 text-white py-3 rounded-xl font-medium hover:bg-red-600 transition-colors"
              >
                ลบ
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const handleDeleteTask = async (taskId) => {
    setTaskToDelete(taskId);
    setShowDeleteModal(true);
  };

  const confirmDeleteTask = async () => {
    if (!taskToDelete) return;

    try {
      await deleteDoc(doc(db, "tasks", taskToDelete));
      toast.success("ลบ task สำเร็จแล้ว!");
    } catch (error) {
      console.error("ลบ task ล้มเหลว:", error);
      toast.error("ลบ task ล้มเหลว");
    } finally {
      setShowDeleteModal(false);
      setTaskToDelete(null);
    }
  };

  const handleEditTask = (task) => {
    // แปลง date format กลับเป็น input format
    let dateValue = "";
    let timeValue = "";

    if (task.date) {
      try {
        let date;
        if (typeof task.date === "string") {
          if (task.date.includes("at") && task.date.includes("UTC+7")) {
            const cleanStr = task.date
              .replace(" at ", " ")
              .replace(" UTC+7", "");
            date = new Date(cleanStr);
          } else if (task.date.includes("UTC+7")) {
            const cleanStr = task.date.replace(" UTC+7", "");
            date = new Date(cleanStr);
          } else {
            date = new Date(task.date);
          }
        }

        if (!isNaN(date.getTime())) {
          dateValue = date.toISOString().split("T")[0];
          timeValue = date.toTimeString().slice(0, 5);
        }
      } catch (error) {
        console.error("Error parsing date for edit:", error);
      }
    }

    setEditingTask({
      ...task,
      date: dateValue,
      time: timeValue,
    });
    setCurrentView("editTask");
  };

  const handleUpdateTask = async () => {
    if (!editingTask?.title.trim()) {
      toast.error("กรุณาใส่ชื่อ task");
      return;
    }

    try {
      const taskRef = doc(db, "tasks", editingTask.id);
      const updatedTask = {
        title: editingTask.title,
        detail: editingTask.detail,
        repeat: editingTask.repeat,
        status: editingTask.status,
        date: formatDateTime(editingTask.date, editingTask.time),
        updatedAt: Timestamp.now(),
      };

      await updateDoc(taskRef, updatedTask);
      setCurrentView("home");
      setEditingTask(null);
      toast.success("อัพเดท task สำเร็จแล้ว!");
    } catch (error) {
      console.error("อัพเดท task ล้มเหลว:", error);
      toast.error("อัพเดท task ล้มเหลว");
    }
  };

  const formatDate = (dateValue, options = {}) => {
    if (!dateValue) return "No date";

    let date;
    try {
      if (typeof dateValue === "string") {
        if (dateValue.includes("at") && dateValue.includes("UTC+7")) {
          const cleanStr = dateValue.replace(" at ", " ").replace(" UTC+7", "");
          date = new Date(cleanStr);
        } else if (dateValue.includes("UTC+7")) {
          const cleanStr = dateValue.replace(" UTC+7", "");
          date = new Date(cleanStr);
        } else {
          date = new Date(dateValue);
        }
      }

      if (isNaN(date.getTime())) return "Invalid Date";

      return date.toLocaleString("th-TH", {
        dateStyle: "medium",
        timeStyle: "short",
        ...options,
      });
    } catch (error) {
      return "Invalid Date";
    }
  };

  const formatDateTime = (date, time) => {
    if (!date || !time) return "";

    const dateTime = new Date(`${date}T${time}`);

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

    const formatted = dateTime.toLocaleDateString("en-US", options);
    return `${formatted} UTC+7`;
  };

const fetchTasks = async () => {
  try {
    setLoading(true);
    
    // ตรวจสอบว่ามี lineUserId และ userName
    if (!session?.lineUserId || !session?.user?.name) {
      console.log("No valid session data");
      setTasks([]);
      return;
    }

    const q = query(
      collection(db, "tasks"),
      where("userId", "==", session.lineUserId),
      where("userName", "==", session.user.name), // เพิ่ม filter userName ด้วย
      orderBy("createdAt", "desc")
    );
    
    const querySnapshot = await getDocs(q);
    const tasksData = [];

    querySnapshot.forEach((doc) => {
      tasksData.push({
        id: doc.id,
        ...doc.data(),
      });
    });

    console.log("Fetched tasks for user:", session.user.name, "ID:", session.lineUserId);
    setTasks(tasksData);
  } catch (error) {
    console.error("Error fetching tasks:", error);
  } finally {
    setLoading(false);
  }
};

const setupTasksListener = () => {
  if (!session?.lineUserId || !session?.user?.name) {
    console.log("Invalid session for listener");
    return;
  }

  const q = query(
    collection(db, "tasks"),
    where("userId", "==", session.lineUserId),
    where("userName", "==", session.user.name), // เพิ่ม filter นี้
    orderBy("createdAt", "desc")
  );

  const unsubscribe = onSnapshot(q, (querySnapshot) => {
    const tasksData = [];
    querySnapshot.forEach((doc) => {
      tasksData.push({
        id: doc.id,
        ...doc.data(),
      });
    });
    console.log("Real-time tasks for:", session.user.name, tasksData.length, "tasks");
    setTasks(tasksData);
    setLoading(false);
  });

  return unsubscribe;
};

  useEffect(() => {
    if (session?.lineUserId) {
      const unsubscribe = setupTasksListener();
      return () => unsubscribe && unsubscribe();
    }
  }, [session]);

  useEffect(() => {
    if (session?.lineUserId) {
      fetchTasks();
    }
  }, [session?.lineUserId]);

  const getFilteredTasks = () => {
    if (activeTab === "All") return tasks;
    return tasks.filter((task) => task.status === activeTab);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "Upcoming":
        return "bg-blue-500";
      case "Completed":
        return "bg-green-500";
      case "Overdue":
        return "bg-red-500";
      default:
        return "bg-gray-500";
    }
  };

  const getTaskBorderColor = (color) => {
    switch (color) {
      case "blue":
        return "border-l-blue-500 bg-white";
      case "green":
        return "border-l-green-500 bg-white";
      case "red":
        return "border-l-red-500 bg-white";
      default:
        return "border-l-gray-500 bg-white";
    }
  };

  if (currentView === "addTask") {
    return (
      <div className="min-h-screen bg-white">
        <div className="bg-white px-6 py-8">
          <h1 className="text-3xl font-bold text-gray-900">Add New Task</h1>
        </div>

        <div className="px-6 py-6 space-y-6 bg-white">
          <div>
            <label className="block text-gray-700 text-sm font-medium mb-2">
              Title *
            </label>
            <input
              type="text"
              value={newTask.title}
              onChange={(e) =>
                setNewTask({ ...newTask, title: e.target.value })
              }
              placeholder="กรอกชื่อ Task"
              style={{color: '#000'}}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-gray-700 text-sm font-medium mb-2">
              Detail *
            </label>
            <textarea
              value={newTask.detail}
              onChange={(e) =>
                setNewTask({ ...newTask, detail: e.target.value })
              }
              style={{color: '#000'}}
              placeholder="กรอกรายละเอียด Task"
              rows={4}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-gray-700 text-sm font-medium mb-2">
              Date *
            </label>
            <div className="relative">
              <input
                type="date"
                value={newTask.date}
                onChange={(e) =>
                  setNewTask({ ...newTask, date: e.target.value })
                }
                style={{color: '#000'}}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-gray-700 text-sm font-medium mb-2">
              Time *
            </label>
            <div className="flex items-center space-x-3">
              <input
                type="time"
                value={newTask.time}
                onChange={(e) =>
                  setNewTask({ ...newTask, time: e.target.value })
                }
                style={{color: '#000'}}
                className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-gray-700 text-sm font-medium mb-2">
              Repeat
            </label>
            <div className="relative">
              <select
                style={{color: '#000'}}
                value={newTask.repeat}
                onChange={(e) =>
                  setNewTask({ ...newTask, repeat: e.target.value })
                }
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
              >
                <option value="Daily">Daily</option>
                <option value="Weekly">Weekly</option>
                <option value="Monthly">Monthly</option>
                <option value="Never">Never</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
            </div>
          </div>

          <div className="flex space-x-4 pt-4">
            <button
              onClick={handleAddTask}
              className="flex-1 bg-blue-500 text-white py-3 rounded-lg font-medium hover:bg-blue-600 transition-colors"
            >
              Add Task
            </button>
            <button
              onClick={() => setCurrentView("home")}
              className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>

        <div
          className="fixed bottom-0 left-0 right-0 bg-white border-gray-200 m-4"
          style={{ borderRadius: "200px" }}
        >
          <div className="flex justify-center items-center py-2">
            <div className="flex items-center space-x-8">
              <button
                className="\p-4"
               
                onClick={() => setCurrentView("home")}
              >
                <Home className="w-6 h-6 text-blue-500" />
              </button>

              <button
                className="bg-blue-100 p-3 rounded-xl"
                onClick={() => setCurrentView("addTask")}
                 style={{ padding: "20px 40px", borderRadius: "200px" }}
              >
                <Plus className="w-6 h-6 text-blue-600" />
              </button>
{/* 
              <button className="p-3">
                <Menu className="w-10 h-10 text-gray-400" />
              </button> */}
            </div>
          </div>
        </div>

        <div className="h-24 bg-white"></div>
      </div>
    );
  }

  if (currentView === "editTask" && editingTask) {
    return (
      <div className="min-h-screen bg-white">
        <div className="bg-white px-6 py-8">
          <h1 className="text-3xl font-bold text-gray-900">Edit Task</h1>
        </div>

        <div className="px-6 py-6 space-y-6 bg-white">
          <div>
            <label className="block text-gray-700 text-sm font-medium mb-2">
              Title *
            </label>
            <input
              type="text"
              value={editingTask.title}
              onChange={(e) =>
                setEditingTask({ ...editingTask, title: e.target.value })
              }
              style={{color: '#000'}}
              placeholder="กรอกชื่อ Task"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-gray-700 text-sm font-medium mb-2">
              Detail *
            </label>
            <textarea
              value={editingTask.detail}
              onChange={(e) =>
                setEditingTask({ ...editingTask, detail: e.target.value })
              }
              style={{color: '#000'}}
              placeholder="กรอกรายละเอียด Task"
              rows={4}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-gray-700 text-sm font-medium mb-2">
              Date *
            </label>
            <div className="relative">
              <input
                type="date"
                value={editingTask.date}
                onChange={(e) =>
                  setEditingTask({ ...editingTask, date: e.target.value })
                }
                style={{color: '#000'}}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-gray-700 text-sm font-medium mb-2">
              Time *
            </label>
            <div className="flex items-center space-x-3">
              <input
                type="time"
                value={editingTask.time}
                onChange={(e) =>
                  setEditingTask({ ...editingTask, time: e.target.value })
                }
                style={{color: '#000'}}
                className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-gray-700 text-sm font-medium mb-2">
              Status
            </label>
            <div className="relative">
              <select
                style={{color: '#000'}}
                value={editingTask.status}
                onChange={(e) =>
                  setEditingTask({ ...editingTask, status: e.target.value })
                }
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
              >
                <option value="Upcoming">Upcoming</option>
                <option value="Completed">Completed</option>
                <option value="Overdue">Overdue</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
            </div>
          </div>

          <div>
            <label className="block text-gray-700 text-sm font-medium mb-2">
              Repeat
            </label>
            <div className="relative">
              <select
              style={{color: '#000'}}
                value={editingTask.repeat}
                onChange={(e) =>
                  setEditingTask({ ...editingTask, repeat: e.target.value })
                }
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
              >
                <option value="Daily">Daily</option>
                <option value="Weekly">Weekly</option>
                <option value="Monthly">Monthly</option>
                <option value="Never">Never</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
            </div>
          </div>

          <div className="flex space-x-4 pt-4">
            <button
              onClick={handleUpdateTask}
              className="flex-1 bg-blue-500 text-white py-3 rounded-lg font-medium hover:bg-blue-600 transition-colors"
            >
              Update Task
            </button>
            <button
              onClick={() => {
                setCurrentView("home");
                setEditingTask(null);
              }}
              className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>

        <div
          className="fixed bottom-0 left-0 right-0 bg-white border-gray-200 m-4"
          style={{ borderRadius: "200px" }}
        >
          <div className="flex justify-center items-center py-2">
            <div className="flex items-center space-x-8">
              <button
                className="bg-blue-500 p-4"
                style={{ padding: "20px 40px", borderRadius: "200px" }}
                onClick={() => setCurrentView("home")}
              >
                <Home className="w-6 h-6 text-white" />
              </button>

              <button
                className="bg-blue-500 p-3 rounded-xl"
                onClick={() => setCurrentView("addTask")}
              >
                <Plus className="w-6 h-6 text-blue-600" />
              </button>

              {/* <button className="p-3">
                <Menu className="w-10 h-10 text-gray-400" />
              </button> */}
            </div>
          </div>
        </div>

        <div className="h-24 bg-white"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "#F0F5FB" }}>
      {session ? (
        <>
          <Toaster position="top-right" />
          <DeleteModal />

          <div className="px-6 pt-8 pb-3 flex">
            <div>
              <img
                src={session.picture}
                width={60}
                style={{ borderRadius: "50%" }}
                alt="Profile"
              />
            </div>
            <div className="ml-3">
              <h1 className="text-3xl font-bold text-gray-900">
                Hello, {session.user.name}
              </h1>
              <p className="text-gray-600">Here all your task!</p>
            </div>
          </div>

          <div className="px-6 py-4">
            <div className="flex space-x-1">
              {tabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === tab
                      ? "bg-blue-500 text-white"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div className="px-6 py-4 space-y-4">
            {loading ? (
              <div className="text-center py-8">
                <p>Loading tasks...</p>
              </div>
            ) : getFilteredTasks().length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500">No tasks found</p>
              </div>
            ) : (
              getFilteredTasks().map((task) => (
                <div
                  key={task.id}
                  className={`border-l-4 ${getTaskBorderColor(
                    task.color
                  )} rounded-r-lg p-4`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h3
                        className="font-semibold text-gray-900 mb-2"
                        style={{ fontSize: "20px" }}
                      >
                        {task.title}
                      </h3>
                      {task.detail && (
                        <p className="text-gray-600 text-sm mb-2">
                          {task.detail}
                        </p>
                      )}
                      <div className="flex items-center text-gray-600 text-sm mb-1">
                        <Calendar className="w-4 h-4 mr-2" />
                        <span>{formatDate(task.date)} น.</span>
                      </div>
                      <div className="flex items-center text-gray-500 text-sm">
                        <Clock className="w-4 h-4 mr-2" />
                        <span>Repeat: {task.repeat}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end space-y-2">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-medium text-white ${getStatusColor(
                          task.status
                        )}`}
                      >
                        {task.status}
                      </span>

                      {task.status === "Upcoming" && (
                        <div className="flex space-x-2">
                          <button
                            onClick={() => handleEditTask(task)}
                            className="flex items-center space-x-1 text-xs px-3 py-1 bg-blue-100 text-blue-600 rounded-md hover:bg-blue-200 transition-colors"
                          >
                            <Edit className="w-3 h-3" />
                            <span>Edit</span>
                          </button>
                          <button
                            onClick={() => handleDeleteTask(task.id)}
                            className="flex items-center space-x-1 text-xs px-3 py-1 bg-red-100 text-red-600 rounded-md hover:bg-red-200 transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Delete</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div
            className="fixed bottom-0 left-0 right-0 bg-white border-gray-200 m-4"
            style={{ borderRadius: "200px" }}
          >
            <div className="flex justify-center items-center py-2">
              <div className="flex items-center space-x-8">
                <button
                  className="bg-blue-500 p-4"
                  style={{ padding: "20px 40px", borderRadius: "200px" }}
                  onClick={() => setCurrentView("home")}
                >
                  <Home className="w-6 h-6 text-white" />
                </button>

                <button
                  className="bg-blue-100 p-3 rounded-xl"
                  onClick={() => setCurrentView("addTask")}
                >
                  <Plus className="w-6 h-6 text-blue-600" />
                </button>

                {/* <button className="p-3">
                  <Menu className="w-10 h-10 text-gray-400" />
                </button> */}
              </div>
            </div>
          </div>

          <div className="h-24"></div>
        </>
      ) : (
        <div className="flex items-center justify-center min-h-screen">
          <button
            style={{ cursor: "pointer" }}
            onClick={() => signIn("line")}
            className="bg-green-500 text-white px-6 py-3 rounded-lg font-medium"
          >
            Login with LINE
          </button>
        </div>
      )}
    </div>
  );
}