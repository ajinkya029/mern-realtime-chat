import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

const API = import.meta.env.VITE_API_URL || "http://localhost:5000";
const initials = (name) =>
  (name || "?")
    .split(" ")
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
const time = (value) =>
  value
    ? new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

export default function App() {
  const [session, setSession] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("pulse_session"));
    } catch {
      return null;
    }
  });
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [users, setUsers] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [online, setOnline] = useState([]);
  const [typing, setTyping] = useState(false);
  const [search, setSearch] = useState("");
  const socketRef = useRef(null);
  const bottomRef = useRef(null);
  const typingTimer = useRef(null);

  const headers = useMemo(
    () => ({
      "Content-Type": "application/json",
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
    }),
    [session],
  );
  async function request(path, options = {}) {
    console.log("Sending request:", {
      url: `${API}${path}`,
      method: options.method || "GET",
      body: options.body,
      headers,
    });

    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        ...headers,
        ...(options.headers || {}),
      },
    });

    const data = await response.json().catch(() => ({}));

    console.log("API response:", response.status, data);

    if (!response.ok) {
      throw new Error(data.message || "Something went wrong");
    }

    return data;
  }

  useEffect(() => {
    if (!session) return;
    let alive = true;
    Promise.all([request("/api/users"), request("/api/conversations")])
      .then(([u, c]) => {
        if (alive) {
          setUsers(u);
          setConversations(c);
        }
      })
      .catch((e) => setError(e.message));
    const socket = io(API, { auth: { token: session.token } });
    socketRef.current = socket;
    socket.on("online_users", setOnline);
    socket.on("receive_message", (message) => {
      if (String(message.conversationId) === String(active?.id))
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== message.id),
          message,
        ]);
      setConversations((prev) => {
        const found = prev.find(
          (c) => String(c.id) === String(message.conversationId),
        );
        if (!found) return prev;
        return [
          {
            ...found,
            lastMessage: {
              text: message.text,
              senderId: message.sender.id,
              createdAt: message.createdAt,
            },
            updatedAt: message.createdAt,
          },
          ...prev.filter((c) => c.id !== found.id),
        ];
      });
    });
    socket.on("conversation_updated", () =>
      request("/api/conversations")
        .then(setConversations)
        .catch(() => {}),
    );
    socket.on("typing", (payload) => {
      if (String(payload.conversationId) === String(active?.id))
        setTyping(true);
    });
    socket.on("stop_typing", (payload) => {
      if (String(payload.conversationId) === String(active?.id))
        setTyping(false);
    });
    socket.on("message_error", setError);
    return () => {
      alive = false;
      socket.disconnect();
    };
  }, [session]);

  useEffect(() => {
    if (!active || !session) return;
    socketRef.current?.emit("join", active.id);
    request(`/api/conversations/${active.id}/messages`)
      .then(setMessages)
      .catch((e) => setError(e.message));
    setTyping(false);
  }, [active?.id, session]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  async function authenticate(e) {
    e.preventDefault();
    setError("");

    console.log("Form values:", {
      name: form.name,
      email: form.email,
      passwordLength: form.password.length,
    });

    try {
      const data = await request(
        `/api/auth/${mode === "login" ? "login" : "register"}`,
        {
          method: "POST",
          body: JSON.stringify(form),
        },
      );

      localStorage.setItem("pulse_session", JSON.stringify(data));
      setSession(data);
    } catch (error) {
      setError(error.message);
    }
  }

  function logout() {
    localStorage.removeItem("pulse_session");
    setSession(null);
    setActive(null);
    setMessages([]);
    setConversations([]);
    setUsers([]);
  }
  async function openChat(user) {
    setError("");
    try {
      const conversation = await request("/api/conversations", {
        method: "POST",
        body: JSON.stringify({ userId: user.id }),
      });
      setConversations((prev) => [
        conversation,
        ...prev.filter((c) => c.id !== conversation.id),
      ]);
      setActive(conversation);
    } catch (e) {
      setError(e.message);
    }
  }
  async function sendMessage(e) {
    e.preventDefault();
    if (!draft.trim() || !active) return;
    socketRef.current?.emit("private_message", {
      conversationId: active.id,
      text: draft.trim(),
    });
    socketRef.current?.emit("stop_typing", { conversationId: active.id });
    setDraft("");
  }
  function onDraft(value) {
    setDraft(value);
    if (!active) return;
    socketRef.current?.emit("typing", { conversationId: active.id });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(
      () =>
        socketRef.current?.emit("stop_typing", { conversationId: active.id }),
      900,
    );
  }

  if (!session)
    return (
      <main className="auth-page">
        <div className="auth-card">
          <div className="brand-mark">✦</div>
          <p className="eyebrow">YOUR SPACE, IN REAL TIME</p>
          <h1>
            {mode === "login" ? "Welcome back." : "Join the conversation."}
          </h1>
          <p className="muted">A quieter, clearer place to connect.</p>
          <form onSubmit={authenticate} className="auth-form">
            {mode === "register" && (
              <input
                placeholder="Your name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            )}
            <input
              type="email"
              placeholder="Email address"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
            <input
              type="password"
              placeholder="Password (at least 8 characters)"
              minLength="8"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
            {error && <p className="error">{error}</p>}
            <button className="primary-btn">
              {mode === "login" ? "Sign in" : "Create account"} <span>→</span>
            </button>
          </form>
          <p className="switch-mode">
            {mode === "login" ? "New to Pulse?" : "Already have an account?"}{" "}
            <button
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError("");
              }}
            >
              {mode === "login" ? "Create an account" : "Sign in"}
            </button>
          </p>
        </div>
      </main>
    );

  const activeUser = active?.participants?.find(
    (p) => String(p.id) !== String(session.user.id),
  );
  const filteredConversations = conversations.filter((c) => {
    const other = c.participants.find(
      (p) => String(p.id) !== String(session.user.id),
    );
    return other?.name.toLowerCase().includes(search.toLowerCase());
  });
  return (
    <main className="app-shell">
      <aside className={`sidebar ${active ? "sidebar-hidden" : ""}`}>
        <div className="side-top">
          <div className="brand">
            <span className="brand-mark small">✦</span>
            <span>pulse</span>
          </div>
          <button className="icon-btn" title="Sign out" onClick={logout}>
            ↗
          </button>
        </div>
        <div className="profile-row">
          <div className="avatar me">{initials(session.user.name)}</div>
          <div>
            <strong>{session.user.name}</strong>
            <small>Available to chat</small>
          </div>
          <span className="online-dot" />
        </div>
        <div className="section-heading">
          <span>MESSAGES</span>
          <span>{conversations.length}</span>
        </div>
        <div className="search-wrap">
          <span>⌕</span>
          <input
            placeholder="Search conversations"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="conversation-list">
          {filteredConversations.map((c) => {
            const other = c.participants.find(
              (p) => String(p.id) !== String(session.user.id),
            );
            const selected = active?.id === c.id;
            return (
              <button
                key={c.id}
                className={`conversation-item ${selected ? "selected" : ""}`}
                onClick={() => setActive(c)}
              >
                <div className="avatar">
                  {initials(other?.name)}
                  {online.includes(String(other?.id)) && <i />}
                </div>
                <div className="conversation-copy">
                  <strong>{other?.name}</strong>
                  <small>{c.lastMessage?.text || "Start a conversation"}</small>
                </div>
                <time>{time(c.lastMessage?.createdAt)}</time>
              </button>
            );
          })}
          {!filteredConversations.length && (
            <p className="empty-hint">No conversations yet.</p>
          )}
        </div>
        <div className="section-heading people-heading">
          <span>PEOPLE</span>
          <span>{users.length}</span>
        </div>
        <div className="people-list">
          {users
            .filter((u) => u.name.toLowerCase().includes(search.toLowerCase()))
            .slice(0, 8)
            .map((user) => (
              <button
                key={user.id}
                className="person-item"
                onClick={() => openChat(user)}
              >
                <div className="avatar">
                  {initials(user.name)}
                  {online.includes(String(user.id)) && <i />}
                </div>
                <span>{user.name}</span>
                <b>＋</b>
              </button>
            ))}
        </div>
        {error && <p className="sidebar-error">{error}</p>}
        <div className="sidebar-footer">
          Made for meaningful conversations <span>✦</span>
        </div>
      </aside>

      <section className={`chat-panel ${!active ? "chat-empty" : ""}`}>
        {!active ? (
          <div className="welcome-state">
            <div className="welcome-icon">✦</div>
            <p className="eyebrow">A LITTLE MORE CONNECTED</p>
            <h2>
              Your conversations
              <br />
              start here.
            </h2>
            <p>
              Choose someone from your people list
              <br />
              or open an existing conversation.
            </p>
          </div>
        ) : (
          <>
            <header className="chat-header">
              <button className="back-btn" onClick={() => setActive(null)}>
                ←
              </button>
              <div className="avatar">
                {initials(activeUser?.name)}
                {online.includes(String(activeUser?.id)) && <i />}
              </div>
              <div className="header-person">
                <strong>{activeUser?.name || "Conversation"}</strong>
                <small>
                  {online.includes(String(activeUser?.id))
                    ? "● Online"
                    : "Offline"}
                </small>
              </div>
              <div className="header-actions">
                <span>ENCRYPTED SPACE</span>
                <button className="icon-btn" title="Sign out" onClick={logout}>
                  ⋯
                </button>
              </div>
            </header>
            <div className="message-area">
              <div className="day-label">
                <span>YOUR CONVERSATION</span>
              </div>
              {messages.map((m, index) => {
                const mine = String(m.sender.id) === String(session.user.id);
                const previous = messages[index - 1];
                const showAvatar =
                  !mine &&
                  (!previous ||
                    String(previous.sender.id) !== String(m.sender.id));
                return (
                  <div
                    key={m.id}
                    className={`message-row ${mine ? "mine" : ""}`}
                  >
                    {!mine && (
                      <div className="avatar tiny">
                        {showAvatar ? initials(m.sender.name) : ""}
                      </div>
                    )}
                    <div className="message-content">
                      <div className="bubble">{m.text}</div>
                      <time>
                        {time(m.createdAt)}
                        {mine ? " · You" : ""}
                      </time>
                    </div>
                  </div>
                );
              })}
              {typing && (
                <div className="typing-indicator">
                  <span></span>
                  <span></span>
                  <span></span> {activeUser?.name} is typing
                </div>
              )}
              <div ref={bottomRef} />
            </div>
            <form className="composer" onSubmit={sendMessage}>
              <input
                value={draft}
                onChange={(e) => onDraft(e.target.value)}
                placeholder="Write a message..."
                maxLength="5000"
              />
              <span className="composer-hint">↵ to send</span>
              <button
                className="send-btn"
                disabled={!draft.trim()}
                aria-label="Send message"
              >
                ↑
              </button>
            </form>
            {error && <p className="chat-error">{error}</p>}
          </>
        )}
      </section>
    </main>
  );
}
