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
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
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
  writeBatch,
  collectionGroup,
  getDoc,
  setDoc, // ADDED: setDoc is useful for adding the user document
} from "firebase/firestore";
import { db } from "../app/firebase/config";
import moment from "moment-timezone";

export default function TaskManager() {
  const { data: session } = useSession();
  const [activeTab, setActiveTab] = useState("Upcoming");
  const [upcomingFilter, setUpcomingFilter] = useState("All");
  const [currentView, setCurrentView] = useState("home");
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingTask, setEditingTask] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState(null);
  const [deleteType, setDeleteType] = useState(null);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [newTask, setNewTask] = useState({
    title: "",
    detail: "",
    date: "",
    time: "",
    repeat: "Never",
    endDate: "",
    color: "blue",
    status: "Upcoming",
  });

  const tabs = ["Upcoming", "Completed", "Incomplete"];
  const upcomingFilters = ["Today", "This Week", "All"];

  // Helper functions for date filtering
  const isToday = (date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const isThisWeek = (date) => {
    const today = new Date();
    const weekStart = new Date(today);
    const weekEnd = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    weekStart.setHours(0, 0, 0, 0);
    weekEnd.setDate(today.getDate() + (6 - today.getDay()));
    weekEnd.setHours(23, 59, 59, 999);
    return date >= weekStart && date <= weekEnd;
  };

  const calculateNotificationDates = (startDate, time, repeat, endDate) => {
    if (repeat === "Never") {
      return [moment.tz(`${startDate}T${time}`, "Asia/Singapore").toDate()];
    }

    const dates = [];
    let currentDate = moment.tz(`${startDate}T${time}`, "Asia/Singapore");
    const end = moment.tz(`${endDate}T23:59:59`, "Asia/Singapore");

    while (currentDate.isSameOrBefore(end)) {
      dates.push(currentDate.toDate());
      switch (repeat) {
        case "Daily":
          currentDate.add(1, "day");
          break;
        case "Weekly":
          currentDate.add(1, "week");
          break;
        case "Monthly":
          currentDate.add(1, "month");
          break;
        default:
          break;
      }
    }

    return dates;
  };

  const handleAddTask = async () => {
    if (
      !session?.lineUserId ||
      !newTask.title.trim() ||
      !newTask.date ||
      !newTask.time
    ) {
      toast.error("Please fill in all required fields.");
      return;
    }

    if (newTask.repeat !== "Never" && !newTask.endDate) {
      toast.error("Please provide an end date for repeating tasks.");
      return;
    }

    try {
      // Step 1: Ensure a user document exists for the current user
      const userDocRef = doc(db, "users", session.lineUserId);
      await setDoc(
        userDocRef,
        {
          name: session.user.name,
          lineUserId: session.lineUserId,
          createdAt: Timestamp.now(),
        },
        { merge: true }
      );

      // Step 2: Create the master task document within the user's subcollection
      const masterTask = {
        title: newTask.title,
        detail: newTask.detail,
        repeatType: newTask.repeat,
        startDate: newTask.date,
        endDate: newTask.endDate,
        userId: session.lineUserId,
        userName: session.user.name,
        createdAt: Timestamp.now(),
      };

      const userTasksCollectionRef = collection(userDocRef, "tasks");
      const docRef = await addDoc(userTasksCollectionRef, masterTask);

      // Step 3: Calculate and create notifications as a subcollection
      const notificationDates = calculateNotificationDates(
        newTask.date,
        newTask.time,
        newTask.repeat,
        newTask.endDate
      );

      const notificationsCollectionRef = collection(docRef, "notifications");
      for (const date of notificationDates) {
        await addDoc(notificationsCollectionRef, {
          notificationTime: Timestamp.fromDate(date),
          status: "Upcoming",
          notified: false,
          userId: session.lineUserId,
        });
      }

      setCurrentView("home");
      setNewTask({
        title: "",
        detail: "",
        date: "",
        time: "",
        repeat: "Never",
        color: "blue",
        status: "Upcoming",
        endDate: "",
      });
      
      // Refresh tasks list
      await fetchTasks();
      toast.success("Task and notifications added successfully!");
    } catch (error) {
      console.error("Failed to add task:", error);
      toast.error("Failed to add task.");
    }
  };

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
              คุณต้องการลบงานนี้อย่างไร?
            </p>
            <div className="flex flex-col space-y-3">
              <button
                onClick={() => confirmDeleteTask("single")}
                className="flex-1 bg-red-500 text-white py-3 rounded-xl font-medium hover:bg-red-600 transition-colors"
              >
                ลบแค่การแจ้งเตือนนี้
              </button>
              <button
                onClick={() => confirmDeleteTask("all")}
                className="flex-1 bg-red-700 text-white py-3 rounded-xl font-medium hover:bg-red-800 transition-colors"
              >
                ลบงานทั้งหมด
              </button>
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setTaskToDelete(null);
                  setDeleteType(null);
                }}
                className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-xl font-medium hover:bg-gray-200 transition-colors"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const handleDeleteTask = async (task) => {
    setTaskToDelete(task);
    setShowDeleteModal(true);
    setCurrentView("home");
  };

  const deleteSingleNotification = async () => {
    try {
      await deleteDoc(
        doc(
          db,
          "users",
          session.lineUserId,
          "tasks",
          taskToDelete.parentId,
          "notifications",
          taskToDelete.id
        )
      );
      
      // Refresh tasks list
      await fetchTasks();
      toast.success("ลบการแจ้งเตือนนี้สำเร็จ!");
    } catch (error) {
      console.error("ลบการแจ้งเตือนล้มเหลว:", error);
      toast.error("ลบการแจ้งเตือนล้มเหลว");
    }
  };

  const deleteAllOccurrences = async () => {
    if (!taskToDelete) return;
    try {
      const parentTaskRef = doc(
        db,
        "users",
        session.lineUserId,
        "tasks",
        taskToDelete.parentId
      );
      const subcollectionSnapshot = await getDocs(
        collection(parentTaskRef, "notifications")
      );

      const batch = writeBatch(db);
      subcollectionSnapshot.docs.forEach((subDoc) => {
        batch.delete(subDoc.ref);
      });

      batch.delete(parentTaskRef);
      await batch.commit();

      // Refresh tasks list
      await fetchTasks();
      toast.success("ลบงานทั้งหมดสำเร็จแล้ว!");
    } catch (error) {
      console.error("ลบงานทั้งหมดล้มเหลว:", error);
      toast.error("ลบงานทั้งหมดล้มเหลว");
    }
  };

  const confirmDeleteTask = async (type) => {
    if (!taskToDelete) return;
    if (type === "single") {
      await deleteSingleNotification();
    } else if (type === "all") {
      await deleteAllOccurrences();
    }
    setShowDeleteModal(false);
    setTaskToDelete(null);
    setDeleteType(null);
  };

  const handleCompleteTask = async (task) => {
    try {
      const notificationRef = doc(
        db,
        "users",
        session.lineUserId,
        "tasks",
        task.parentId,
        "notifications",
        task.id
      );
      await updateDoc(notificationRef, {
        status: "Completed",
      });

      // Refresh tasks list
      await fetchTasks();
      toast.success("Task completed successfully!");
      setCurrentView("home");
    } catch (error) {
      console.error("Failed to complete task:", error);
      toast.error("Failed to complete task.");
    }
  };

  const handleEditTask = (task) => {
    let dateValue = "";
    let timeValue = "";

    if (task.notificationTime) {
      const date = task.notificationTime.toDate();
      dateValue = date.toISOString().split("T")[0];
      timeValue = date.toTimeString().slice(0, 5);
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
      const parentTaskRef = doc(
        db,
        "users",
        session.lineUserId,
        "tasks",
        editingTask.parentId
      );
      const notificationRef = doc(
        db,
        "users",
        session.lineUserId,
        "tasks",
        editingTask.parentId,
        "notifications",
        editingTask.id
      );

      await updateDoc(parentTaskRef, {
        title: editingTask.title,
        detail: editingTask.detail,
        updatedAt: Timestamp.now(),
      });

      await updateDoc(notificationRef, {
        notificationTime: Timestamp.fromDate(
          new Date(`${editingTask.date}T${editingTask.time}`)
        ),
        status: editingTask.status,
      });

      setCurrentView("home");
      setEditingTask(null);
      
      // Refresh tasks list
      await fetchTasks();
      toast.success("อัพเดท task สำเร็จแล้ว!");
    } catch (error) {
      console.error("อัพเดท task ล้มเหลว:", error);
      toast.error("อัพเดท task ล้มเหลว");
    }
  };

const formatDate = (dateValue, options = {}) => {
  if (!dateValue) return "No date";
  let date;
  if (dateValue instanceof Timestamp) {
    date = dateValue.toDate();
  } else {
    date = new Date(dateValue);
  }
  try {
    if (isNaN(date.getTime())) return "Invalid Date";
    
    // กำหนดชื่อเดือนเป็นภาษาไทย
    const monthNames = [
      'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
    ];
    
    // กำหนดชื่อวันเป็นภาษาไทย
    const dayNames = [
      'อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'
    ];
    
    const dayName = dayNames[date.getDay()];
    const day = date.getDate();
    const month = monthNames[date.getMonth()];
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    
    return `วัน${dayName}ที่ ${day} ${month} ${hours}:${minutes}`;
    
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

  // UPDATED: Fetches all notifications from the user's specific subcollection
  const fetchTasks = async () => {
    try {
      setLoading(true);
      if (!session?.lineUserId) {
        setTasks([]);
        return;
      }

      const tasksData = [];
      const userTasksCollectionRef = collection(
        db,
        "users",
        session.lineUserId,
        "tasks"
      );
      const parentQuery = query(
        userTasksCollectionRef,
        orderBy("createdAt", "desc")
      );

      const parentSnapshot = await getDocs(parentQuery);

      for (const parentDoc of parentSnapshot.docs) {
        const parentData = parentDoc.data();
        const notificationsQuery = collection(parentDoc.ref, "notifications");
        const notificationsSnapshot = await getDocs(notificationsQuery);

        notificationsSnapshot.forEach((notificationDoc) => {
          const notificationData = notificationDoc.data();
          tasksData.push({
            id: notificationDoc.id,
            parentId: parentDoc.id,
            title: parentData.title,
            detail: parentData.detail,
            repeatType: parentData.repeatType,
            notificationTime: notificationData.notificationTime,
            status: notificationData.status,
            notified: notificationData.notified,
            color: parentData.color || "blue",
          });
        });
      }

      setTasks(tasksData);
    } catch (error) {
      console.error("Error fetching tasks:", error);
    } finally {
      setLoading(false);
    }
  };

  // UPDATED: Sets up a real-time listener on the user's specific tasks subcollection
  const setupTasksListener = () => {
    if (!session?.lineUserId) {
      return () => {};
    }
    const userTasksCollectionRef = collection(
      db,
      "users",
      session.lineUserId,
      "tasks"
    );
    const parentQuery = query(
      userTasksCollectionRef,
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(parentQuery, (parentSnapshot) => {
      fetchTasks();
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

  // const getFilteredTasks = () => {
  //   let filteredTasks = tasks.filter((task) => task.status === activeTab);
  //   if (activeTab === "Upcoming" && upcomingFilter !== "All") {
  //     filteredTasks = filteredTasks.filter((task) => {
  //       if (!task.notificationTime) return false;
  //       try {
  //         const taskDate = task.notificationTime.toDate();
  //         if (upcomingFilter === "Today") {
  //           return isToday(taskDate);
  //         } else if (upcomingFilter === "This Week") {
  //           return isThisWeek(taskDate);
  //         }
  //         return true;
  //       } catch (error) {
  //         console.error("Error filtering task by date:", error);
  //         return false;
  //       }
  //     });
  //   }
  //   return filteredTasks;
  // };

  // from linebot/src/app/page.js

  const getFilteredTasks = () => {
    let filteredTasks = tasks.filter((task) => task.status === activeTab);
    if (activeTab === "Upcoming" && upcomingFilter !== "All") {
      filteredTasks = filteredTasks.filter((task) => {
        if (!task.notificationTime) return false;
        try {
          const taskDate = task.notificationTime.toDate();
          if (upcomingFilter === "Today") {
            return isToday(taskDate);
          } else if (upcomingFilter === "This Week") {
            return isThisWeek(taskDate);
          }
          return true;
        } catch (error) {
          console.error("Error filtering task by date:", error);
          return false;
        }
      });
    }

    // Add this sorting logic to display the nearest tasks first
    if (activeTab === "Upcoming") {
      filteredTasks.sort((a, b) => {
        try {
          const timeA = a.notificationTime?.toDate() || new Date(0);
          const timeB = b.notificationTime?.toDate() || new Date(0);
          return timeA.getTime() - timeB.getTime();
        } catch (error) {
          console.error("Error sorting tasks:", error);
          return 0;
        }
      });
    }

    return filteredTasks;
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "Upcoming":
        return "bg-blue-500";
      case "Completed":
        return "bg-green-500";
      case "Incomplete":
        return "bg-red-500";
      default:
        return "bg-gray-500";
    }
  };

  const getTaskBorderColor = (color) => {
    switch (color) {
      case "blue":
        return "bg-white";
      case "green":
        return "bg-white";
      case "red":
        return "bg-white";
      default:
        return "bg-white";
    }
  };

  const getDaysInMonth = (date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const getTasksForDate = (date) => {
    const targetYear = date.getFullYear();
    const targetMonth = date.getMonth();
    const targetDay = date.getDate();
    return tasks.filter((task) => {
      if (!task.notificationTime) return false;
      try {
        const taskDate = task.notificationTime.toDate();
        return (
          taskDate.getFullYear() === targetYear &&
          taskDate.getMonth() === targetMonth &&
          taskDate.getDate() === targetDay
        );
      } catch (error) {
        console.error("Error parsing task date:", error, task.notificationTime);
        return false;
      }
    });
  };

  const navigateMonth = (direction) => {
    setCurrentDate((prev) => {
      const newDate = new Date(prev);
      newDate.setMonth(prev.getMonth() + direction);
      return newDate;
    });
  };

  const renderCalendar = () => {
    const daysInMonth = getDaysInMonth(currentDate);
    const firstDay = getFirstDayOfMonth(currentDate);
    const today = new Date();
    const monthNames = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const days = [];
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} className="h-12"></div>);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        day
      );
      const isToday = date.toDateString() === today.toDateString();
      const isSelected =
        selectedDate && date.toDateString() === selectedDate.toDateString();
      const tasksForDay = getTasksForDate(date);
      days.push(
        <button
          key={day}
          onClick={() => setSelectedDate(date)}
          className="h-12 relative hover:bg-gray-50 rounded-lg transition-colors p-1"
        >
          <div
            className={`w-10 h-10 flex items-center justify-center rounded-full text-sm font-medium transition-colors ${
              isToday
                ? "bg-black text-white"
                : isSelected
                ? "bg-blue-500 text-white"
                : "text-gray-900 hover:bg-gray-100"
            }`}
          >
            {day}
          </div>
          {tasksForDay.length > 0 && (
            <div className="flex absolute -bottom-1 left-1/2 transform -translate-x-1/2 space-x-1">
              {tasksForDay.slice(0, 3).map((task, index) => (
                <div
                  key={index}
                  className={`w-2 h-2 rounded-full ${
                    task.status === "Completed"
                      ? "bg-green-400"
                      : task.status === "Incomplete"
                      ? "bg-red-400"
                      : "bg-blue-400"
                  }`}
                />
              ))}
              {tasksForDay.length > 3 && (
                <div className="w-2 h-2 rounded-full bg-gray-400" />
              )}
            </div>
          )}
        </button>
      );
    }
    return (
      <div className="bg-white rounded-xl p-6 mx-4 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900">
            {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
          </h2>
          <div className="flex space-x-2">
            <button
              onClick={() => navigateMonth(-1)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ChevronLeft className="w-5 h-5 text-gray-600" />
            </button>
            <button
              onClick={() => navigateMonth(1)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ChevronRight className="w-5 h-5 text-gray-600" />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-2 mb-4">
          {dayNames.map((day) => (
            <div
              key={day}
              className="text-center text-sm font-medium text-gray-500 py-2"
            >
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-2">{days}</div>
      </div>
    );
  };

  const renderSelectedDateTasks = () => {
    if (!selectedDate) return null;
    const selectedTasks = getTasksForDate(selectedDate);
    const dateStr = selectedDate.toLocaleDateString("th-TH", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    return (
      <div className="mx-4 mt-6">
        <div className="bg-white rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              Tasks for {dateStr}
            </h3>
          </div>
          {selectedTasks.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                <Calendar className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-gray-500 mb-4">No tasks for this day</p>
              <button
                onClick={() => {
                  const dateStr = selectedDate.toISOString().split("T")[0];
                  setNewTask({
                    ...newTask,
                    date: dateStr,
                    time: "09:00",
                  });
                  setCurrentView("addTask");
                }}
                className="w-full bg-blue-50 text-blue-600 py-3 rounded-lg hover:bg-blue-100 transition-colors flex items-center justify-center space-x-2"
              >
                <Plus className="w-4 h-4" />
                <span>Add New Task</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {selectedTasks
                .sort((a, b) => {
                  try {
                    const timeA = a.notificationTime.toDate();
                    const timeB = b.notificationTime.toDate();
                    return timeA - timeB;
                  } catch {
                    return 0;
                  }
                })
                .map((task) => {
                  let timeStr = "";
                  try {
                    const taskDate = task.notificationTime.toDate();
                    timeStr = taskDate.toLocaleTimeString("th-TH", {
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                  } catch (error) {
                    timeStr = "Invalid time";
                  }
                  return (
                    <div key={task.id}>
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-2">
                            <Clock className="w-4 h-4 text-gray-500" />
                            <span className="text-sm text-gray-500">
                              {timeStr}
                            </span>
                            <span
                              className={`px-2 py-1 rounded-full text-xs font-medium text-white ${getStatusColor(
                                task.status
                              )}`}
                            >
                              {task.status}
                            </span>
                          </div>
                          <h4 className="font-semibold text-gray-900 mb-1">
                            {task.title}
                          </h4>
                          {task.detail && (
                            <p className="text-gray-600 text-sm mb-2">
                              {task.detail}
                            </p>
                          )}
                          {/* <div className="flex items-center text-gray-500 text-xs">
                            <span>Repeat: {task.repeatType}</span>
                          </div> */}
                        </div>
                        <div className="flex space-x-2 ml-4">
                          {task.status === "Upcoming" && (
                            <>
                              <button
                                onClick={async () => {
                                  await handleCompleteTask(task);
                                  await fetchTasks(); // Refresh list
                                }}
                                className="flex items-center space-x-1 text-xs px-2 py-1 bg-green-100 text-green-600 rounded-md hover:bg-green-200 transition-colors"
                              >
                                <CheckCircle className="w-3 h-3" />
                                <span>Complete</span>
                              </button>
                              <button
                                onClick={() => handleEditTask(task)}
                                className="flex items-center space-x-1 text-xs px-2 py-1 bg-blue-100 text-blue-600 rounded-md hover:bg-blue-200 transition-colors"
                              >
                                <Edit className="w-3 h-3" />
                                <span>Edit</span>
                              </button>
                              <button
                                onClick={() => handleDeleteTask(task)}
                                className="flex items-center space-x-1 text-xs px-2 py-1 bg-red-100 text-red-600 rounded-md hover:bg-red-200 transition-colors"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Delete</span>
                              </button>
                            </>
                          )}
                          {(task.status === "Completed" ||
                            task.status === "Incomplete") && (
                            <div className="flex space-x-2">
                              <button
                                onClick={() => handleDeleteTask(task)}
                                className="flex items-center space-x-1 text-xs px-2 py-1 bg-red-100 text-red-600 rounded-md hover:bg-red-200 transition-colors"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Delete</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

              <div className="pt-4">
                <button
                  onClick={() => {
                    const dateStr = selectedDate.toISOString().split("T")[0];
                    setNewTask({
                      ...newTask,
                      date: dateStr,
                      time: "09:00",
                    });
                    setCurrentView("addTask");
                  }}
                  className="w-full bg-blue-50 text-blue-600 py-3 rounded-lg hover:bg-blue-100 transition-colors flex items-center justify-center space-x-2"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add New Task</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const getTodayTasks = () => {
    const today = new Date();
    return getTasksForDate(today);
  };

  const renderTodaySchedule = () => {
    if (selectedDate) return null;

    const todayTasks = getTodayTasks();
    const morningTasks = todayTasks.filter((task) => {
      try {
        let taskDate = task.notificationTime.toDate();
        return taskDate.getHours() < 12;
      } catch {
        return false;
      }
    });

    const eveningTasks = todayTasks.filter((task) => {
      try {
        let taskDate = task.notificationTime.toDate();
        return taskDate.getHours() >= 18;
      } catch {
        return false;
      }
    });

    return (
      <div className="mx-4 mt-6 space-y-6">
        <div className="bg-white rounded-xl p-6 shadow-sm">
          <div className="space-y-8">
            {morningTasks.length > 0 && (
              <div className="flex items-center space-x-4">
                <div className="text-gray-500 text-sm w-12">08:00</div>
                <div className="flex-shrink-0">
                  <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                    <Clock className="w-6 h-6 text-red-500" />
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="text-sm text-gray-500">08:00 ↻</span>
                  </div>
                  <h3 className="font-semibold text-gray-900 text-lg">
                    {morningTasks[0].title}
                  </h3>
                </div>
                <div
                  className={`w-6 h-6 rounded-full border-2 ${
                    morningTasks[0].status === "Completed"
                      ? "bg-red-500 border-red-500"
                      : "border-red-300"
                  }`}
                />
              </div>
            )}
            {eveningTasks.length > 0 && (
              <div className="flex items-center space-x-4">
                <div className="text-gray-500 text-sm w-12">22:00</div>
                <div className="flex-shrink-0">
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                    <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                      <div className="w-3 h-3 bg-white rounded-full"></div>
                    </div>
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="text-sm text-gray-500">22:00 ↻</span>
                  </div>
                  <h3 className="font-semibold text-gray-900 text-lg">
                    {eveningTasks[0].title}
                  </h3>
                </div>
                <div
                  className={`w-6 h-6 rounded-full border-2 ${
                    eveningTasks[0].status === "Completed"
                      ? "bg-blue-500 border-blue-500"
                      : "border-blue-300"
                  }`}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (currentView === "calendar") {
    return (
      <div className="min-h-screen" style={{ background: "rgb(240 245 251 / 77%)" }}>
        <Toaster position="top-right" />
        <div className="px-6 pt-8 pb-4">
          <h1 className="text-3xl font-bold text-gray-900">Calendar</h1>
          <p className="text-gray-600">Your task schedule</p>
        </div>
        {renderCalendar()}
        {selectedDate ? renderSelectedDateTasks() : renderTodaySchedule()}
        <div
          className="fixed bottom-0 left-0 right-0 bg-[#E9F3FF] border-gray-200 py-1"
        >
          <div className="flex justify-center items-center py-2">
            <div className="flex items-center space-x-6">
              <button className="p-4" onClick={() => setCurrentView("home")}>
                <Home className="w-6 h-6 text-gray-400" />
              </button>
              <button
                className="bg-blue-100 p-3 rounded-xl"
                onClick={() => setCurrentView("addTask")}
              >
                <Plus className="w-6 h-6 text-blue-600" />
              </button>
              <button
                className="bg-blue-500 p-4"
                style={{ padding: "20px 40px", borderRadius: "200px" }}
                onClick={() => setCurrentView("calendar")}
              >
                <CalendarDays className="w-6 h-6 text-white" />
              </button>
            </div>
          </div>
        </div>
        <div className="h-24"></div>
      </div>
    );
  }

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
              style={{ color: "#000" }}
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
              style={{ color: "#000" }}
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
                style={{ color: "#000" }}
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
                style={{ color: "#000" }}
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
                style={{ color: "#000" }}
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
          {newTask.repeat !== "Never" && (
            <div>
              <label className="block text-gray-700 text-sm font-medium mb-2">
                End Date *
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={newTask.endDate}
                  onChange={(e) =>
                    setNewTask({ ...newTask, endDate: e.target.value })
                  }
                  style={{ color: "#000" }}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}
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
          className="fixed bottom-0 left-0 right-0 bg-[#E9F3FF] border-gray-200 py-1"
        >
          <div className="flex justify-center items-center py-2">
            <div className="flex items-center space-x-6">
              <button className="p-4" onClick={() => setCurrentView("home")}>
                <Home className="w-6 h-6 text-gray-400" />
              </button>
              <button
                className="bg-blue-500 p-4"
                onClick={() => setCurrentView("addTask")}
                style={{ padding: "20px 40px", borderRadius: "200px" }}
              >
                <Plus className="w-6 h-6 text-white" />
              </button>
              <button
                className="p-4"
                onClick={() => setCurrentView("calendar")}
              >
                <CalendarDays className="w-6 h-6 text-gray-400" />
              </button>
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
              style={{ color: "#000" }}
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
              style={{ color: "#000" }}
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
                style={{ color: "#000" }}
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
                style={{ color: "#000" }}
                className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-gray-700 text-sm font-medium mb-2">
              Status
            </label>
            {/* <div className="relative">
              <select
                style={{ color: "#000" }}
                value={editingTask.status}
                onChange={(e) =>
                  setEditingTask({ ...editingTask, status: e.target.value })
                }
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
              >
                <option value="Upcoming">Upcoming</option>
                <option value="Completed">Completed</option>
                <option value="Incomplete">Incomplete</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
            </div> */}
          </div>
          <div>
            <label className="block text-gray-700 text-sm font-medium mb-2">
              Repeat
            </label>
            <div className="relative">
              <select
                style={{ color: "#000" }}
                value={editingTask.repeatType}
                onChange={(e) =>
                  setEditingTask({ ...editingTask, repeatType: e.target.value })
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
          {editingTask.status === "Upcoming" && (
            <div className="flex space-x-2 w-full">
              <button
                onClick={async () => {
                  await handleCompleteTask(editingTask);
                  await fetchTasks(); // Refresh list
                }}
                className="flex-1 flex items-center justify-center space-x-1 text-xs px-3 py-2 bg-green-100 text-green-600 rounded-md hover:bg-green-200 transition-colors"
              >
                <CheckCircle className="w-3 h-3" />
                <span>Complete</span>
              </button>

              <button
                onClick={() => handleDeleteTask(editingTask)}
                className="flex-1 flex items-center justify-center space-x-1 text-xs px-3 py-2 bg-red-100 text-red-600 rounded-md hover:bg-red-200 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                <span>Delete</span>
              </button>
            </div>
          )}

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
          className="fixed bottom-0 left-0 right-0 bg-[#E9F3FF] border-gray-200 py-1"
        >
          <div className="flex justify-center items-center py-2">
            <div className="flex items-center space-x-6">
              <button
                className="bg-blue-500 p-4"
                style={{ padding: "20px 40px", borderRadius: "200px" }}
                onClick={() => setCurrentView("home")}
              >
                <Home className="w-6 h-6 text-white" />
              </button>
              <button className="p-4" onClick={() => setCurrentView("addTask")}>
                <Plus className="w-6 h-6 text-gray-400" />
              </button>
              <button
                className="p-4"
                onClick={() => setCurrentView("calendar")}
              >
                <CalendarDays className="w-6 h-6 text-gray-400" />
              </button>
            </div>
          </div>
        </div>
        <div className="h-24 bg-white"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "rgb(240 245 251 / 77%)" }}>
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
          {activeTab === "Upcoming" && (
            <div className="px-6 pb-4">
              <div className="flex space-x-1">
                {upcomingFilters.map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setUpcomingFilter(filter)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      upcomingFilter === filter
                        ? "bg-blue-100 text-blue-600 border border-blue-300"
                        : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>
          )}
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
                <div key={task.id} className="pb-4" style={{borderBottom: '1px solid #E5E5E5'}}>
                  
                  <div
                    className="flex justify-between items-start"
                    onClick={() => handleEditTask(task)}
                  >
                    <div className="flex-1">
                      <h3
                        className="font-semibold text-gray-900 mb-2"
                        style={{ fontSize: "20px" }}
                      >
                        {task.title}
                      </h3>
                      {/* {task.detail && (
                        <p className="text-gray-600 text-sm mb-2">
                          {task.detail}
                        </p>
                      )} */}
                      <div className="flex items-center">
                        <div className="flex items-center text-gray-600 text-sm">
                          <Calendar className="w-4 h-4 mr-2" />
                          <span>{formatDate(task.notificationTime)} น.</span>
                        </div>
                        {/* <div className="flex items-center text-gray-500 text-sm ml-3">
                          <Clock className="w-4 h-4 mr-2" />
                          <span>Repeat: {task.repeatType}</span>
                        </div> */}
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
                      {/* {task.status === "Upcoming" && (
                        <div className="flex space-x-2">
                          <button
                            onClick={async () => {
                              await handleCompleteTask(task);
                              await fetchTasks(); // Refresh list after complete
                            }}
                            className="flex items-center space-x-1 text-xs px-3 py-1 bg-green-100 text-green-600 rounded-md hover:bg-green-200 transition-colors"
                          >
                            <CheckCircle className="w-3 h-3" />
                            <span>Complete</span>
                          </button>
                          <button
                            onClick={() => handleEditTask(task)}
                            className="flex items-center space-x-1 text-xs px-3 py-1 bg-blue-100 text-blue-600 rounded-md hover:bg-blue-200 transition-colors"
                          >
                            <Edit className="w-3 h-3" />
                            <span>Edit</span>
                          </button>
                          <button
                            onClick={() => handleDeleteTask(task)}
                            className="flex items-center space-x-1 text-xs px-3 py-1 bg-red-100 text-red-600 rounded-md hover:bg-red-200 transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Delete</span>
                          </button>
                        </div>
                      )}
                      {(task.status === "Completed" || task.status === "Incomplete") && (
                        <div className="flex space-x-2">
                          <button
                            onClick={() => handleDeleteTask(task)}
                            className="flex items-center space-x-1 text-xs px-3 py-1 bg-red-100 text-red-600 rounded-md hover:bg-red-200 transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Delete</span>
                          </button>
                        </div>
                      )} */}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          <div
            className="fixed bottom-0 left-0 right-0 bg-[#E9F3FF] border-gray-200 py-1"
            
          >
            <div className="flex justify-center items-center py-2">
              <div className="flex items-center space-x-6">
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
                <button
                  className="p-4"
                  onClick={() => setCurrentView("calendar")}
                >
                  <CalendarDays className="w-6 h-6 text-gray-400" />
                </button>
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