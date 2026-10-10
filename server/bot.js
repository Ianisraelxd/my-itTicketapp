// HelpDesk Assistant: a guided, multiple-choice chatbot that talks to the person who
// submitted a ticket, inside the ticket conversation.
//
// Design (borrowed from Intercom, Zendesk Answer Bot, ServiceNow Virtual Agent, Freshdesk):
//   - guided quick-reply buttons instead of open-ended typing, so people always know what to do next
//   - it knows the ticket: status, technician, queue position and the priority's target time
//   - self-service first: step-by-step fixes for the ticket's category, then "did that fix it?"
//   - a clear human hand-off that passes along what was already tried, so nobody repeats themselves
//   - actions, not just answers: it can send a cancellation request, reopen a ticket, flag urgency
//   - satisfaction rating once a ticket is resolved
//
// It is rule-based (no external AI service): every answer is predictable and free.
// Messages are stored in ticket_messages (kind: bot | bot_choice | bot_note) so the
// conversation survives a refresh and staff can see what the assistant already covered.
import { pool, query } from "./db.js";
import { SLA_MINUTES } from "./kpiCatalog.js";

const BOT_NAME = "HelpDesk Assistant";
let botUserId = null;

async function getBotId() {
  if (botUserId) return botUserId;
  const rows = await query("SELECT user_pk FROM users WHERE role = 'bot' LIMIT 1");
  if (rows[0]) {
    botUserId = rows[0].user_pk;
    return botUserId;
  }
  // The password is not a valid hash, so nobody can ever sign in as the assistant.
  const [result] = await pool.execute(
    "INSERT INTO users (id_number, password, name, role, role_name, email) VALUES ('assistant', 'scrypt$locked$locked', ?, 'bot', 'Assistant Bot', NULL)",
    [BOT_NAME],
  );
  botUserId = result.insertId;
  return botUserId;
}

// --- Knowledge base: common problems and what to try --------------------------------
const KNOWLEDGE = {
  Hardware: [
    {
      key: "power",
      label: "It won't turn on",
      steps: [
        "Check the power cable is firmly plugged in at both ends and the outlet or power strip has power (try another outlet).",
        "Laptop: unplug the charger, hold the power button for 15 seconds, then plug in and try again.",
        "Look for any light or fan noise: if there is none, the power supply may have failed.",
      ],
    },
    {
      key: "screen",
      label: "Screen is blank or flickering",
      steps: [
        "Make sure the monitor is on and the cable (HDMI/VGA/DisplayPort) is fully seated at both ends.",
        "Turn the brightness up and press Windows + Ctrl + Shift + B to refresh the display.",
        "Try a different cable or monitor if you can. Restart the computer.",
      ],
    },
    {
      key: "peripheral",
      label: "Keyboard or mouse isn't working",
      steps: [
        "Unplug it and plug it into a different USB port. For wireless ones, replace the batteries.",
        "Bluetooth: turn Bluetooth off and on, then reconnect the device.",
        "Try the device on another computer to see whether the device or the computer is the problem.",
      ],
    },
    {
      key: "slow",
      label: "It's slow or keeps freezing",
      steps: [
        "Save your work and restart the computer.",
        "Close programs you are not using (Ctrl + Shift + Esc opens Task Manager so you can see what is using the most).",
        "Check that the disk is not almost full (File Explorer > This PC).",
      ],
    },
    {
      key: "heat",
      label: "It's very hot or making noise",
      steps: [
        "Save your work and shut down. If you smell burning, unplug it right away and do not use it.",
        "Move it to a hard, flat surface and make sure the vents are not blocked.",
        "Leave it to cool for 15 minutes before turning it back on.",
      ],
    },
  ],
  Software: [
    {
      key: "crash",
      label: "A program won't open or keeps crashing",
      steps: [
        "Close the program completely (Task Manager > End task) and open it again.",
        "Restart the computer, then check for an update of the program.",
        "Right-click the program and choose Run as administrator. If it still fails, note the exact error message.",
      ],
    },
    {
      key: "install",
      label: "I can't install something",
      steps: [
        "Make sure there is enough free disk space and that no other installer is running.",
        "Check you have permission to install software on this computer; campus computers usually need an admin.",
        "Download the installer again from the official source and run it as administrator.",
      ],
    },
    {
      key: "office",
      label: "Office / Microsoft 365 keeps asking me to sign in",
      steps: [
        "Sign out of every Office app (File > Account > Sign out), close them, then sign in again with your campus email.",
        "Check you are using the right account and that your password has not expired.",
        "Windows: open Credential Manager and remove old Microsoft Office entries, then sign in again.",
      ],
    },
    {
      key: "update",
      label: "Windows or an app is stuck updating",
      steps: [
        "Leave it for 20 to 30 minutes: big updates can look frozen.",
        "If nothing changes, restart the computer and run Windows Update again.",
        "Keep the computer plugged in while it updates.",
      ],
    },
  ],
  "Network / Internet": [
    {
      key: "wifi",
      label: "I can't connect to Wi-Fi",
      steps: [
        "Turn Wi-Fi off and on (or turn Airplane mode on and off).",
        "Forget the network, then reconnect and enter the password again.",
        "Restart your device and check whether other devices can connect. Move closer to the access point if you can.",
      ],
    },
    {
      key: "nointernet",
      label: "Connected, but no internet",
      steps: [
        "Try opening a different website. If only one site fails, the problem is with that site.",
        "Disconnect and reconnect to the network. Wired: unplug and replug the network cable.",
        "Windows: open Command Prompt and run ipconfig /flushdns, then try again.",
      ],
    },
    {
      key: "slownet",
      label: "The internet is very slow",
      steps: [
        "Close streaming, downloads and other devices that may be using the connection.",
        "Run a speed test at fast.com and note the result.",
        "Move closer to the access point or try a wired connection.",
      ],
    },
    {
      key: "portal",
      label: "A website or portal won't load",
      steps: [
        "Try a different browser or a private (incognito) window.",
        "Clear the browser cache and cookies for that site, then reload.",
        "Check the address is typed correctly and try again in a few minutes.",
      ],
    },
  ],
  "Account / Login": [
    {
      key: "password",
      label: "I forgot my password",
      steps: [
        "On the HelpDesk login page use Forgot password, or ask an admin to review a password change request from your profile.",
        "For campus email or portals, use that service's own Forgot password link.",
        "Never share your password, not even with IT staff.",
      ],
    },
    {
      key: "locked",
      label: "My account is locked",
      steps: [
        "After 5 wrong tries an account locks for 15 minutes. Wait, then sign in again.",
        "If you are in a hurry, ask a super admin to clear the lockout.",
        "Check that Caps Lock is off and that you chose the right role on the login screen.",
      ],
    },
    {
      key: "signin",
      label: "I can't sign in to email or a portal",
      steps: [
        "Check your ID or email is typed exactly right and Caps Lock is off.",
        "Try a private (incognito) window, or clear the browser cookies and try again.",
        "If you see a specific error message, note it down for the technician.",
      ],
    },
    {
      key: "access",
      label: "I need access to something",
      steps: [
        "Write down exactly what you need access to (system, folder, printer, course).",
        "Ask your supervisor or instructor to confirm that you should have it.",
        "Tell the technician those details: they usually need that approval.",
      ],
    },
  ],
  Printer: [
    {
      key: "noprint",
      label: "It won't print",
      steps: [
        "Check the printer is on, online, and has paper, ink or toner, and no error light.",
        "Cancel stuck jobs: Settings > Printers > your printer > Open queue > cancel all documents.",
        "Turn the printer off for 30 seconds and back on. Make sure it is chosen as your default printer.",
      ],
    },
    {
      key: "jam",
      label: "There's a paper jam",
      steps: [
        "Turn the printer off, then open the covers and trays.",
        "Pull the jammed paper out gently in the direction it normally travels, so it does not tear.",
        "Make sure no scraps remain, close everything, turn it on and reprint.",
      ],
    },
    {
      key: "quality",
      label: "Prints are faded, streaky or blurry",
      steps: [
        "Run the printer's cleaning or head-alignment option from its menu or print settings.",
        "Replace or reseat the ink or toner cartridge.",
        "Check you are using the right paper type.",
      ],
    },
    {
      key: "missing",
      label: "I can't find the printer",
      steps: [
        "Make sure the printer is on and connected to the same network as your computer.",
        "Windows: Settings > Printers & scanners > Add device, then pick the printer.",
        "Ask a neighbour whether it works for them, to see if it is only your computer.",
      ],
    },
  ],
};

const FALLBACK_PROBLEMS = [
  {
    key: "generic",
    label: "Something else",
    steps: [
      "Restart the device or program and try again.",
      "Write down exactly what you see, including any error message.",
      "Tell the technician what you were doing when it happened.",
    ],
  },
];

const problemsFor = (category) => KNOWLEDGE[category] || FALLBACK_PROBLEMS;
const findProblem = (category, key) =>
  [...problemsFor(category), ...FALLBACK_PROBLEMS].find((problem) => problem.key === key);

// --- Presence: staff count as available if they used the app in the last 90 seconds ------
export async function staffAvailability(assignedTo = null) {
  const rows = await query(
    "SELECT user_pk, name, role FROM users WHERE role IN ('technician', 'admin') AND last_seen_at > DATE_SUB(NOW(), INTERVAL 90 SECOND) ORDER BY name",
  );
  const assigned = rows.find((row) => assignedTo && row.user_pk === assignedTo);
  return {
    assignedOnline: assigned?.name ?? null,
    technicians: rows.filter((row) => row.role === "technician").map((row) => row.name),
    admins: rows.filter((row) => row.role === "admin").map((row) => row.name),
    anyOnline: rows.length > 0,
  };
}

const listNames = (names) =>
  names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;

// One friendly sentence about who can chat right now.
function availabilityLine(a) {
  if (a.assignedOnline) return `${a.assignedOnline}, your technician, is online and can chat with you now.`;
  if (a.technicians.length) return `${listNames(a.technicians)} (technician) ${a.technicians.length === 1 ? "is" : "are"} online and can chat now.`;
  if (a.admins.length) return `${listNames(a.admins)} (admin) ${a.admins.length === 1 ? "is" : "are"} online and can chat now.`;
  return "Our technicians and admins are offline right now, so I'll help in the meantime. They'll see everything here when they're back.";
}

// --- Small helpers -----------------------------------------------------------------------
const opt = (id, label) => ({ id, label });

const numbered = (steps) => steps.map((step, index) => `${index + 1}. ${step}`).join("\n");

function duration(minutes) {
  const total = Math.max(1, Math.round(minutes));
  if (total < 60) return `${total} min`;
  if (total < 1440) {
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  const days = Math.floor(total / 1440);
  const hours = Math.round((total % 1440) / 60);
  return hours ? `${days} d ${hours} h` : `${days} d`;
}

const targetMinutes = (priority) => SLA_MINUTES[priority] ?? SLA_MINUTES.Low;

function formatWhen(date) {
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// --- Menus ------------------------------------------------------------------------------------
function mainMenu(ctx) {
  const { status } = ctx.ticket;
  if (status === "Resolved") {
    return [
      ...(ctx.ticket.csat_rating ? [] : [opt("rate:ask", "⭐ Rate the support")]),
      opt("reopen:ask", "↩ The problem is not fixed"),
      opt("more", "💡 More help"),
    ];
  }
  if (status === "Cancelled") {
    return [opt("more", "💡 More help")];
  }
  return [
    opt("status", "📍 Where is my ticket?"),
    opt("fix", "🛠 Try a quick fix"),
    opt("time", "⏱ How long will it take?"),
    opt("urgent:ask", "🚨 It's urgent"),
    opt("human", "👤 Talk to a technician"),
    opt("more", "💡 More help"),
  ];
}

const backToMenu = (ctx) => [opt("menu", "🏠 Back to the menu"), ...(ctx.ticket.status === "Resolved" || ctx.ticket.status === "Cancelled" ? [] : [])];

// --- The conversation: one choice in, replies (and an optional staff note) out -----------
async function handle(choice, ctx, deps) {
  const { ticket, firstName } = ctx;
  const [kind, part, extra] = choice.split(":");

  switch (kind) {
    case "menu":
      return {
        replies: [{ text: `What can I help you with, ${firstName}?`, options: mainMenu(ctx) }],
      };

    case "status": {
      const submittedMins = (Date.now() - new Date(ticket.created_at).getTime()) / 60000;
      const lines = [];
      if (ticket.status === "Open") {
        lines.push(`${ticket.code} is waiting for a technician.`);
        lines.push(
          ctx.queueAhead > 0
            ? `${ctx.queueAhead} other request${ctx.queueAhead === 1 ? " is" : "s are"} ahead of yours.`
            : "Yours is next in line.",
        );
      } else if (ticket.status === "In Progress") {
        lines.push(
          ticket.techName
            ? `${ticket.techName} is working on ${ticket.code}.`
            : `${ticket.code} is being worked on.`,
        );
      } else if (ticket.status === "Resolved") {
        lines.push(`${ticket.code} was marked as resolved.`);
      } else {
        lines.push(`${ticket.code} is ${ticket.status.toLowerCase()}.`);
      }
      lines.push(`Submitted ${duration(submittedMins)} ago · Priority: ${ticket.priority}.`);
      if (ctx.pendingCancellation) lines.push("A cancellation request is waiting for an admin to decide.");
      if (ticket.reopen_count > 0) lines.push(`It has been reopened ${ticket.reopen_count} time${ticket.reopen_count === 1 ? "" : "s"}.`);
      return { replies: [{ text: lines.join("\n"), options: [...mainMenu(ctx).filter((o) => o.id !== "status")] }] };
    }

    case "time": {
      const minutes = targetMinutes(ticket.priority);
      const deadline = new Date(new Date(ticket.created_at).getTime() + minutes * 60000);
      const overdue = deadline < new Date() && !["Resolved", "Cancelled"].includes(ticket.status);
      const text = [
        `Our target times by priority: High ${duration(SLA_MINUTES.High)}, Medium ${duration(SLA_MINUTES.Medium)}, Low ${duration(SLA_MINUTES.Low)}.`,
        `Yours is ${ticket.priority}, so we aim to fix it within ${duration(minutes)} of submitting (around ${formatWhen(deadline)}).`,
        overdue
          ? "That time has passed, so I'm sorry for the wait. Pick \"Talk to a technician\" and I'll nudge the team."
          : "These are targets, not guarantees: complicated problems can take longer.",
      ].join("\n");
      return { replies: [{ text, options: mainMenu(ctx).filter((o) => o.id !== "time") }] };
    }

    case "fix": {
      if (part) {
        // fix:<problem>: show the steps
        const problem = findProblem(ticket.category, part);
        if (!problem) return { replies: [{ text: "I'm not sure about that one.", options: mainMenu(ctx) }] };
        return {
          replies: [
            {
              text: `${problem.label}\nTry these steps in order:\n${numbered(problem.steps)}`,
              options: [
                opt(`fixed:${problem.key}`, "✅ That fixed it"),
                opt(`notfixed:${problem.key}`, "❌ Still not working"),
                opt("fix", "🔁 Show a different fix"),
              ],
            },
          ],
        };
      }
      const problems = problemsFor(ticket.category);
      return {
        replies: [
          {
            text: `These are the most common ${ticket.category === "Others" ? "" : `${ticket.category} `}problems I can help with. Which one sounds like yours?`,
            options: [
              ...problems.map((problem) => opt(`fix:${problem.key}`, problem.label)),
              opt("fix:none", "None of these"),
            ],
          },
        ],
      };
    }

    case "fixed": {
      const problem = findProblem(ticket.category, part);
      return {
        replies: [
          {
            text: "Wonderful, glad that worked! 🎉\nSince it's working again, would you like me to ask an admin to close this ticket? You can also keep it open just in case.",
            options: [
              opt(`cancel:go:fixed-${problem?.key || "self"}`, "Yes, ask to close it"),
              opt("menu", "Keep it open for now"),
            ],
          },
        ],
      };
    }

    case "notfixed": {
      const problem = findProblem(ticket.category, part);
      return {
        replies: [
          {
            text: "Sorry that didn't solve it. I've passed on what you tried, so the technician won't ask you to repeat it.",
            options: [
              opt("fix", "Try another fix"),
              opt("human", "👤 Talk to a technician"),
              opt("menu", "🏠 Back to the menu"),
            ],
          },
        ],
        note: {
          text: `Assistant note: the requester tried the quick fix "${problem?.label || "a quick fix"}" for ${ticket.category} and it did not help.`,
          notify: { type: "bot_handoff", title: "Quick fix did not work", body: `${ticket.code}: the requester tried "${problem?.label || "a quick fix"}" and it did not help.` },
        },
      };
    }

    case "urgent": {
      if (part === "ask") {
        return {
          replies: [
            {
              text: "I'll flag it to the team. What best describes the urgency?",
              options: [
                opt("urgent:class", "I have a class, exam or deadline soon"),
                opt("urgent:blocked", "I can't work at all without this"),
                opt("urgent:safety", "There is a safety concern"),
                opt("menu", "Never mind"),
              ],
            },
          ],
        };
      }
      const reasons = {
        class: "has a class, exam or deadline soon",
        blocked: "cannot work at all without this",
        safety: "reports a safety concern",
      };
      if (!reasons[part]) return { replies: [{ text: "I didn't catch that.", options: mainMenu(ctx) }] };
      return {
        replies: [
          {
            text: "Done: I've flagged this as urgent to the admins and the technician, with your reason.\nIf there is any danger (smoke, sparks, a burning smell), unplug the device and move away from it.",
            options: mainMenu(ctx).filter((o) => o.id !== "urgent:ask"),
          },
        ],
        note: {
          text: `Assistant note: the requester says this is urgent (${reasons[part]}).`,
          notify: { type: "bot_urgent", title: "Marked as urgent", body: `${ticket.code}: the requester ${reasons[part]}.` },
          throttle: "urgent",
        },
      };
    }

    case "human": {
      const a = ctx.availability;
      const text = a.anyOnline
        ? `Good news: ${availabilityLine(a)}\nI've let them know you'd like to talk. Type your message in the box below and they'll reply right here.`
        : `${availabilityLine(a)}\nI've notified them, so leave your message in the box below with as much detail as you can. They'll reply here as soon as they're back. In the meantime I can still help with quick fixes.`;
      return {
        replies: [{ text, options: mainMenu(ctx).filter((o) => o.id !== "human") }],
        note: {
          text: "Assistant note: the requester asked to talk to a technician.",
          notify: { type: "bot_handoff", title: "Requester wants a person", body: `${ticket.code}: the requester asked to talk to a technician.` },
          throttle: "human",
        },
      };
    }

    case "more":
      return {
        replies: [
          {
            text: "Here is some extra help:",
            options: [
              opt("faq:cancel", "How do I cancel a request?"),
              opt("faq:details", "How do I add more details?"),
              opt("faq:reopen", "What if it comes back after being fixed?"),
              opt("faq:roles", "Who is working on my ticket?"),
              opt("menu", "🏠 Back to the menu"),
            ],
          },
        ],
      };

    case "faq": {
      const answers = {
        cancel:
          "You can't cancel a ticket directly. Instead you send a cancellation request with a reason and an admin approves it. I can send it for you: choose \"Cancel my request\".",
        details:
          "Just type your message in the box below: the assigned technician and the admins will see it. Photos aren't supported yet, so describe what you see.",
        reopen:
          "Once a ticket is marked resolved you'll see an option here (and a Reopen button) if the problem returns. You can reopen a ticket up to 3 times.",
        roles:
          ticket.techName
            ? `${ticket.techName} is the technician on this ticket. Admins can also see the conversation.`
            : "No technician is assigned yet. An admin assigns tickets based on skills, and you'll be notified when it happens.",
      };
      const options = [
        ...(part === "cancel" && !["Resolved", "Cancelled"].includes(ticket.status) ? [opt("cancel:ask", "❌ Cancel my request")] : []),
        opt("more", "💡 More help"),
        opt("menu", "🏠 Back to the menu"),
      ];
      return { replies: [{ text: answers[part] || "I'm not sure about that one.", options }] };
    }

    case "cancel": {
      if (["Resolved", "Cancelled"].includes(ticket.status)) {
        return { replies: [{ text: `${ticket.code} is already ${ticket.status.toLowerCase()}, so there's nothing to cancel.`, options: mainMenu(ctx) }] };
      }
      if (part === "ask") {
        return {
          replies: [
            {
              text: "I can send a cancellation request to the admins (they approve it). Why do you want to cancel?",
              options: [
                opt("cancel:go:self", "I fixed it myself"),
                opt("cancel:go:noneed", "I don't need it any more"),
                opt("cancel:go:mistake", "I submitted it by mistake"),
                opt("cancel:go:duplicate", "It's a duplicate"),
                opt("menu", "Keep my request"),
              ],
            },
          ],
        };
      }
      const reasons = {
        self: "I fixed it myself.",
        noneed: "I don't need this any more.",
        mistake: "I submitted it by mistake.",
        duplicate: "This is a duplicate request.",
      };
      const key = extra || "";
      const reason = key.startsWith("fixed-")
        ? `Fixed it with the Assistant's quick fix: ${findProblem(ticket.category, key.slice(6))?.label || "quick fix"}.`
        : reasons[key];
      if (!reason) return { replies: [{ text: "I didn't catch that.", options: mainMenu(ctx) }] };
      const result = await deps.fileCancellationRequest({ ticket, user: ctx.user, reason });
      if (result.error) {
        return { replies: [{ text: result.error, options: mainMenu(ctx) }] };
      }
      return {
        replies: [
          {
            text: `I've sent the cancellation request (${result.code}). An admin will review it and you'll get a notification with their decision. Until then the ticket stays open.`,
            options: mainMenu(ctx),
          },
        ],
      };
    }

    case "reopen": {
      if (ticket.status !== "Resolved") {
        return { replies: [{ text: `${ticket.code} isn't resolved at the moment, so there's nothing to reopen.`, options: mainMenu(ctx) }] };
      }
      if (part === "ask") {
        return {
          replies: [
            {
              text: "I'm sorry it isn't fixed. I can reopen the ticket and tell the technician. What happened?",
              options: [
                opt("reopen:go:same", "The same problem came back"),
                opt("reopen:go:never", "It was never really fixed"),
                opt("reopen:go:partly", "It's only partly fixed"),
                opt("menu", "Never mind"),
              ],
            },
          ],
        };
      }
      const reasons = {
        same: "The same problem came back.",
        never: "It was never really fixed.",
        partly: "It is only partly fixed.",
      };
      const reason = reasons[extra || ""];
      if (!reason) return { replies: [{ text: "I didn't catch that.", options: mainMenu(ctx) }] };
      const result = await deps.reopenTicketFor({ ticket, user: ctx.user, reason });
      if (result.error) return { replies: [{ text: result.error, options: [opt("menu", "🏠 Back to the menu")] }] };
      return {
        replies: [
          {
            text: `I've reopened ${ticket.code} and told the technician and the admins. Add any extra detail in the box below.`,
            options: [opt("menu", "🏠 Back to the menu")],
          },
        ],
      };
    }

    case "rate": {
      if (ticket.status !== "Resolved") {
        return { replies: [{ text: "Ratings open once a ticket is resolved.", options: mainMenu(ctx) }] };
      }
      if (ticket.csat_rating) {
        return { replies: [{ text: "You've already rated this ticket. Thank you!", options: mainMenu(ctx) }] };
      }
      if (part === "ask") {
        return {
          replies: [
            {
              text: "How would you rate the support you got?",
              options: [
                opt("rate:5", "⭐⭐⭐⭐⭐ Excellent"),
                opt("rate:4", "⭐⭐⭐⭐ Good"),
                opt("rate:3", "⭐⭐⭐ Okay"),
                opt("rate:2", "⭐⭐ Poor"),
                opt("rate:1", "⭐ Very poor"),
                opt("bye", "Skip"),
              ],
            },
          ],
        };
      }
      const rating = Number(part);
      if (!(rating >= 1 && rating <= 5)) return { replies: [{ text: "I didn't catch that.", options: mainMenu(ctx) }] };
      await deps.saveRating({ ticket, rating });
      if (rating <= 2) {
        return {
          replies: [
            {
              text: "Thank you for being honest, and I'm sorry we fell short. I've let the admins know. Would you like me to reopen the ticket?",
              options: [opt("reopen:ask", "↩ Reopen the ticket"), opt("human", "👤 Talk to a technician"), opt("bye", "No, thanks")],
            },
          ],
          note: {
            text: `Assistant note: the requester rated this ticket ${rating} out of 5.`,
            notify: { type: "bot_handoff", title: "Low satisfaction rating", body: `${ticket.code} was rated ${rating} out of 5.`, adminsOnly: true },
          },
        };
      }
      return {
        replies: [
          {
            text: `Thank you! ${rating >= 4 ? "Happy to hear it. 😊" : "We'll keep working to do better."} Your rating helps us improve.`,
            options: [opt("more", "💡 More help")],
          },
        ],
      };
    }

    case "bye":
      return { replies: [{ text: "No problem! I'm here whenever you need me. Use \"Ask the assistant\" any time.", options: null }] };

    default:
      return { replies: [{ text: "I'm not sure about that one. Here's what I can do:", options: mainMenu(ctx) }] };
  }
}

// --- Persistence ------------------------------------------------------------------------------
const MESSAGE_SELECT = `SELECT m.message_pk AS id, m.sender_pk AS senderId, u.name AS senderName, u.role_name AS senderRole,
    m.message_text AS text, m.kind, m.meta, m.created_at AS createdAt
  FROM ticket_messages m JOIN users u ON u.user_pk = m.sender_pk`;

// Shape a stored row for the client (adds the parsed quick-reply options).
export function shapeMessage(row) {
  let options = null;
  if (row.meta) {
    try {
      options = JSON.parse(row.meta).options ?? null;
    } catch {
      options = null;
    }
  }
  const { meta, ...rest } = row;
  void meta;
  return { ...rest, options };
}

async function insertMessage(ticketPk, senderPk, text, kind, options = null) {
  const meta = options && options.length ? JSON.stringify({ options }) : null;
  const [result] = await pool.execute(
    "INSERT INTO ticket_messages (ticket_pk, sender_pk, message_text, kind, meta) VALUES (?, ?, ?, ?, ?)",
    [ticketPk, senderPk, text, kind, meta],
  );
  return result.insertId;
}

async function loadMessages(ids, { staff }) {
  if (ids.length === 0) return [];
  const rows = await query(
    `${MESSAGE_SELECT} WHERE m.message_pk IN (${ids.map(() => "?").join(", ")}) ORDER BY m.message_pk`,
    ids,
  );
  return rows.filter((row) => staff || row.kind !== "bot_note").map(shapeMessage);
}

async function loadContext(code, user) {
  const [ticket] = await query(
    `SELECT t.ticket_pk, t.code, t.subject, t.category, t.priority, t.status, t.created_by, t.assigned_to,
       t.created_at, t.csat_rating, t.reopen_count, a.name AS techName
     FROM tickets t LEFT JOIN users a ON a.user_pk = t.assigned_to WHERE t.code = ? LIMIT 1`,
    [code],
  );
  const [ahead] = await query(
    "SELECT COUNT(*) AS n FROM tickets WHERE status = 'Open' AND (created_at < ? OR (created_at = ? AND ticket_pk < ?))",
    [ticket.created_at, ticket.created_at, ticket.ticket_pk],
  );
  const [pending] = await query(
    "SELECT COUNT(*) AS n FROM cancellation_requests WHERE ticket_pk = ? AND status = 'Pending'",
    [ticket.ticket_pk],
  );
  return {
    ticket,
    user,
    firstName: String(user.name || "there").split(" ")[0],
    queueAhead: Number(ahead.n),
    pendingCancellation: Number(pending.n) > 0,
    availability: await staffAvailability(ticket.assigned_to),
  };
}

// The options the requester was last offered: only these (or "menu") may be chosen.
async function lastOffered(ticketPk) {
  const rows = await query(
    "SELECT meta FROM ticket_messages WHERE ticket_pk = ? AND kind = 'bot' AND meta IS NOT NULL ORDER BY message_pk DESC LIMIT 1",
    [ticketPk],
  );
  if (!rows[0]) return [];
  try {
    return JSON.parse(rows[0].meta).options ?? [];
  } catch {
    return [];
  }
}


// --- Understanding typed messages (keyword intents, no external AI) -----------------------
const PROBLEM_WORDS = {
  power: ["turn on", "turns on", "power", "boot", "won't start", "wont start", "dead"],
  screen: ["screen", "display", "monitor", "blank", "flicker", "black"],
  peripheral: ["keyboard", "mouse", "usb", "touchpad"],
  slow: ["slow", "freez", "lag", "hang", "stuck", "not responding"],
  heat: ["hot", "heat", "fan", "noise", "overheat", "burning"],
  crash: ["crash", "won't open", "wont open", "not opening", "closes", "error", "not working"],
  install: ["install", "setup", "set up"],
  office: ["office", "microsoft", "365", "word", "excel", "powerpoint", "teams"],
  update: ["update", "updating", "upgrade"],
  wifi: ["wifi", "wi-fi", "wireless", "connect"],
  nointernet: ["no internet", "internet", "offline", "cannot browse"],
  slownet: ["slow internet", "speed", "buffering"],
  portal: ["website", "portal", "page", "load", "site"],
  password: ["password", "forgot", "reset"],
  locked: ["locked", "lockout", "too many attempts"],
  signin: ["login", "log in", "sign in", "email", "cannot access my account"],
  access: ["access", "permission", "folder", "not allowed"],
  noprint: ["won't print", "wont print", "not printing", "cannot print", "can't print", "doesn't print", "no print", "ayaw mag-print"],
  jam: ["jam", "paper stuck", "stuck paper", "naipit", "papel"],
  quality: ["faded", "streak", "blur", "ink", "toner", "lines"],
  missing: ["find the printer", "printer not found", "add printer", "no printer"],
};

const INTENTS = [
  ["urgent:ask", /\b(urgent|asap|emergency|immediately|right now|deadline|exam|class (is )?(starting|in))\b/i],
  ["cancel:ask", /\b(cancel|never ?mind|no need|don'?t need|do not need|by mistake|duplicate)\b/i],
  ["human", /\b(technician|human|person|someone|real person|staff|admin|talk to|speak to)\b/i],
  ["time", /\b(how long|when will|how soon|eta|how many (days|hours|minutes)|estimated|taking so long|so long)\b/i],
  ["status", /\b(status|update|progress|where is|any news|assigned|who is|queue|waiting)\b/i],
  ["thanks", /\b(thanks|thank you|salamat|ty|appreciate)\b/i],
  ["fixedit", /\b(works now|working now|it works|fixed it|solved|ok now|okay now|nawala na|gumana na)\b/i],
  ["hello", /^\s*(hi|hello|hey|good (morning|afternoon|evening)|help|menu|options)\b/i],
];


// --- Tagalog (Filipino) support: understands typed Tagalog and answers in Tagalog ----------
const TAGALOG_MARKERS = /\b(ang|ng|mga|po|ako|ko|ka|mo|ayaw|hindi|di|wala|pa|kasi|namin|natin|paano|bakit|gaano|kailan|salamat|naman|lang|ba|nasaan|kumusta|musta|puwede|pwede|gusto|kailangan|sira|mabagal|ito|yung|yong|na po|opo)\b/gi;

export function isTagalog(text) {
  const found = new Set((String(text).match(TAGALOG_MARKERS) || []).map((word) => word.toLowerCase()));
  return found.size >= 2 || TL_INTENTS.some(([, pattern]) => pattern.test(text));
}

const TL_INTENTS = [
  ["urgent:ask", /\b(madalian|apurahan|agad|ngayon na|ngayon din|kailangan na|importante|exam|klase|deadline)\b/i],
  ["cancel:ask", /\b(kanselahin|i-cancel|ikansela|huwag na|wag na|hindi na kailangan|di na kailangan|nagkamali|mali ang)\b/i],
  ["human", /\b(kausapin|makausap|pakausap|tao|teknisyan|technician|staff)\b/i],
  ["time", /\b(gaano katagal|kailan|ilang araw|ilang oras|hanggang kailan|ang tagal|matagal na)\b/i],
  ["status", /\b(anong balita|may balita|may update|nasaan na|ano na|pila|sino ang gumagawa|progress)\b/i],
  ["thanks", /\b(salamat|maraming salamat|thank)\b/i],
  ["fixedit", /\b(gumagana na|gumana na|ok na|okay na|naayos na|nawala na)\b/i],
  ["hello", /^\s*(kumusta|musta|magandang (umaga|hapon|gabi)|tulong|pakitulong)\b/i],
];

const TL_PROBLEM_WORDS = {
  power: ["ayaw bumukas", "di bumubukas", "ayaw mag-on", "walang kuryente", "patay"],
  screen: ["itim", "walang display", "blangko", "kumikislap", "screen"],
  peripheral: ["keyboard", "mouse"],
  slow: ["mabagal", "nag-hang", "nag-freeze", "bumabagal", "nahihirapan"],
  heat: ["mainit", "umiinit", "maingay"],
  crash: ["nag-crash", "nagsasara", "may error", "ayaw bumukas ang"],
  install: ["i-install", "ma-install", "hindi ma-install"],
  update: ["nag-a-update", "update"],
  wifi: ["wifi", "wi-fi", "ayaw kumonekta", "hindi makakonekta", "mahina ang wifi"],
  nointernet: ["walang internet", "walang signal"],
  slownet: ["mabagal ang internet"],
  portal: ["ayaw mag-load", "hindi bumubukas ang website"],
  password: ["nakalimutan", "nalimutan", "password"],
  locked: ["na-lock", "naka-lock"],
  signin: ["hindi makapag-login", "ayaw mag-login", "hindi makapasok"],
  access: ["walang access", "hindi ako pinapayagan"],
  noprint: ["ayaw mag-print", "hindi nagpi-print", "hindi nagpi-print"],
  jam: ["naipit", "nasiksik", "jam"],
  quality: ["malabo", "may guhit", "kupas"],
  missing: ["hindi makita ang printer"],
};

const TL_LABELS = {
  "📍 Where is my ticket?": "📍 Nasaan na ang ticket ko?",
  "🛠 Try a quick fix": "🛠 Subukan ang mabilisang ayos",
  "⏱ How long will it take?": "⏱ Gaano katagal ito?",
  "🚨 It's urgent": "🚨 Urgent ito",
  "👤 Talk to a technician": "👤 Kausapin ang technician",
  "💡 More help": "💡 Iba pang tulong",
  "🏠 Back to the menu": "🏠 Bumalik sa menu",
  "✅ That fixed it": "✅ Naayos nito",
  "❌ Still not working": "❌ Hindi pa rin gumagana",
  "🔁 Show a different fix": "🔁 Ibang ayos naman",
  "None of these": "Wala sa mga ito",
  "Never mind": "Huwag na",
  "I have a class, exam or deadline soon": "May klase, exam o deadline ako malapit na",
  "I can't work at all without this": "Hindi ako makagawa nang wala ito",
  "There is a safety concern": "May alalahanin sa kaligtasan",
};

// Ordered sentence patterns: [regex on one line, replacement]. Unknown lines stay in English.
const TL_LINES = [
  [/^What can I help you with, (.+)\?$/, "Ano ang maitutulong ko sa iyo, $1?"],
  [/^(#HD\d+) is waiting for a technician\.$/, "Naghihintay pa ng technician ang $1."],
  [/^(\d+) other requests? (?:is|are) ahead of yours\.$/, "May $1 pang request na nauuna sa iyo."],
  [/^Yours is next in line\.$/, "Ikaw na ang susunod."],
  [/^(.+) is working on (#HD\d+)\.$/, "Si $1 ay gumagawa na sa $2."],
  [/^(#HD\d+) is being worked on\.$/, "Ginagawa na ang $1."],
  [/^(#HD\d+) was marked as resolved\.$/, "Na-mark na bilang resolved ang $1."],
  [/^Submitted (.+) ago · Priority: (.+)\.$/, "Isinumite $1 na ang nakalipas · Priority: $2."],
  [/^A cancellation request is waiting for an admin to decide\.$/, "May cancellation request na naghihintay ng desisyon ng admin."],
  [/^Our target times by priority: (.+)$/, "Ang target namin ayon sa priority: $1"],
  [/^Yours is (\w+), so we aim to fix it within (.+) of submitting \(around (.+)\)\.$/, "Ang sa iyo ay $1, kaya target naming maayos ito sa loob ng $2 mula nang isumite (mga $3)."],
  [/^These are targets, not guarantees.*$/, "Target lang ito at hindi garantiya: maaaring tumagal ang mas komplikadong problema."],
  [/^That time has passed.*$/, "Lumampas na ang oras na iyon, pasensya na sa paghihintay. Piliin ang \"Kausapin ang technician\" at ipapaalala ko sa team."],
  [/^I'll flag it to the team\. What best describes the urgency\?$/, "Ipapaalam ko ito sa team. Alin ang pinakaakma sa pagka-urgent?"],
  [/^Done: I've flagged this as urgent.*$/, "Tapos na: minarkahan ko ito bilang urgent sa mga admin at sa technician, kasama ang dahilan mo."],
  [/^If there is any danger.*$/, "Kung may panganib (usok, kislap, amoy ng sunog), i-unplug agad ang device at lumayo rito."],
  [/^Good news: (.+) is online and can chat now\.$/, "Magandang balita: online si $1 at puwede kang makausap ngayon."],
  [/^Good news: (.+), your technician, is online and can chat with you now\.$/, "Magandang balita: online si $1, ang technician mo, at puwede kang makausap ngayon."],
  [/^(.+), your technician, is online and can chat with you now\.$/, "Online si $1, ang technician mo, at puwede kang makausap ngayon."],
  [/^(.+) \((admin|technician)\) (?:is|are) online and can chat now\.$/, "Online ang $1 ($2) at puwede kang makausap ngayon."],
  [/^Good news: (.+) \((admin|technician)\) (?:is|are) online and can chat now\.$/, "Magandang balita: online ang $1 ($2) at puwede kang makausap ngayon."],
  [/^I've let them know you'd like to talk\..*$/, "Naipaalam ko na sa kanila na gusto mo silang makausap. I-type ang mensahe mo sa baba at doon sila sasagot."],
  [/^Our technicians and admins are offline right now.*$/, "Offline ang mga technician at admin ngayon, kaya ako muna ang tutulong. Makikita nila ang lahat dito pagbalik nila."],
  [/^I've notified them, so leave your message.*$/, "Naabisuhan ko na sila, kaya iwan ang mensahe mo sa baba nang may detalye. Sasagot sila rito pagbalik nila. Habang naghihintay, makakatulong pa rin ako sa mga mabilisang ayos."],
  [/^You're welcome! .*$/, "Walang anuman! 😊 May iba pa ba akong maitutulong?"],
  [/^Hi (.+)! What can I help you with\?$/, "Hi $1! Ano ang maitutulong ko?"],
  [/^I'm not sure I understood that.*$/, "Hindi ko sigurado kung naintindihan ko iyon, pero naipadala na ang mensahe mo sa team. Habang naghihintay, ito ang magagawa ko:"],
  [/^The team is offline right now and will reply when they're back\.$/, "Offline ang team ngayon at sasagot sila pagbalik nila."],
  [/^Try these steps in order:$/, "Subukan ang mga hakbang na ito nang may ayos (nasa English):"],
  [/^These are the most common .*problems I can help with\..*$/, "Ito ang mga pinakakaraniwang problema na matutulungan ko. Alin ang kahawig ng sa iyo?"],
  [/^Wonderful, glad that worked!.*$/, "Mabuti at gumana! 🎉"],
  [/^Since it's working again.*$/, "Dahil gumagana na ulit, gusto mo bang hilingin ko sa admin na isara ang ticket na ito? Puwede mo rin itong iwanang bukas."],
  [/^Sorry that didn't solve it\..*$/, "Pasensya na at hindi ito nakatulong. Naipasa ko na ang mga sinubukan mo kaya hindi na kailangang ulitin ng technician."],
  [/^I can send a cancellation request.*$/, "Maipapadala ko ang cancellation request sa mga admin (sila ang magpapasya). Bakit mo gustong kanselahin?"],
];

function localizeLine(line) {
  for (const [pattern, replacement] of TL_LINES) {
    if (pattern.test(line)) return line.replace(pattern, replacement);
  }
  return line;
}

export function toTagalog(text) {
  return String(text).split("\n").map(localizeLine).join("\n");
}

export function toTagalogOptions(options) {
  return options ? options.map((option) => ({ ...option, label: TL_LABELS[option.label] || option.label })) : options;
}

function detectChoice(text, category) {
  for (const [choice, pattern] of INTENTS) if (pattern.test(text)) return choice;
  for (const [choice, pattern] of TL_INTENTS) if (pattern.test(text)) return choice;
  const lower = text.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const problem of [...problemsFor(category), ...FALLBACK_PROBLEMS]) {
    const words = [...(PROBLEM_WORDS[problem.key] || []), ...(TL_PROBLEM_WORDS[problem.key] || [])];
    const score = words.filter((word) => lower.includes(word)).length;
    if (score > bestScore) {
      best = problem.key;
      bestScore = score;
    }
  }
  return best ? `fix:${best}` : null;
}

export function createBot(deps) {
  // First message of every ticket: a greeting that says what happens next.
  async function postGreeting({ ticketPk, code, subject, category, requesterName }) {
    const firstName = String(requesterName || "there").split(" ")[0];
    const ctx = { ticket: { status: "Open", csat_rating: null }, firstName };
    const botId = await getBotId();
    const availability = await staffAvailability();
    await insertMessage(
      ticketPk,
      botId,
      `Hi ${firstName}! 👋 I'm the HelpDesk Assistant.\nYour request ${code} (${subject}) is in the queue and the team has been notified.\n${availabilityLine(availability)}\nWhile you wait, I can check on it, suggest quick ${category && category !== "Others" ? `${category} ` : ""}fixes, or get you to a technician. What would you like to do?`,
      "bot",
      mainMenu(ctx),
    );
  }

  // When a technician resolves the ticket: check in and ask for a rating.
  async function postResolvedPrompt({ ticketPk, code, requesterName, techName }) {
    const firstName = String(requesterName || "there").split(" ")[0];
    const botId = await getBotId();
    await insertMessage(
      ticketPk,
      botId,
      `Good news, ${firstName}: ${code} was marked as resolved${techName ? ` by ${techName}` : ""}. 🎉\nIs everything working now? Your feedback helps us improve.`,
      "bot",
      [opt("rate:ask", "⭐ Yes, rate the support"), opt("reopen:ask", "↩ No, it's still broken"), opt("bye", "Skip")],
    );
  }

  // Runs one choice: saves the replies (and the staff note), returns the new message ids.
  // `echo` is the requester's pick shown as their bubble; typed messages pass null.
  async function execute(choice, ctx, user, echo, tl = false) {
    const botId = await getBotId();
    const result = await handle(choice, ctx, {
      fileCancellationRequest: deps.fileCancellationRequest,
      reopenTicketFor: deps.reopenTicketFor,
      saveRating: async ({ ticket, rating }) => {
        await query(
          "UPDATE tickets SET csat_rating = ?, csat_at = NOW() WHERE ticket_pk = ? AND status = 'Resolved' AND csat_rating IS NULL",
          [rating, ticket.ticket_pk],
        );
      },
    });

    // Reload what changed (status, rating) so the options on the new messages match reality.
    const fresh = (await loadContext(ctx.ticket.code, user)).ticket;
    const ids = (echo ? [await insertMessage(fresh.ticket_pk, user.user_pk, echo, "bot_choice")] : []);
    for (const reply of result.replies) {
      // Menus built before an action ran may be stale: rebuild the generic ones.
    let options = reply.options && reply.options.length ? reply.options : null;
    let text = reply.text;
    if (tl) {
      text = toTagalog(text);
      options = toTagalogOptions(options);
    }
    ids.push(await insertMessage(fresh.ticket_pk, botId, text, "bot", options));
    }

    if (result.note) {
      ids.push(await insertMessage(fresh.ticket_pk, botId, result.note.text, "bot_note"));
      if (result.note.notify) {
        const recent = result.note.throttle
          ? await query(
              "SELECT message_pk FROM ticket_messages WHERE ticket_pk = ? AND kind = 'bot_note' AND message_text = ? AND created_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE) AND message_pk < ?",
              [fresh.ticket_pk, result.note.text, ids.at(-1)],
            )
          : [];
        if (recent.length === 0) {
          const recipients = result.note.notify.adminsOnly
            ? await deps.adminIds()
            : fresh.assigned_to
              ? [fresh.assigned_to, ...(result.note.notify.type === "bot_urgent" ? await deps.adminIds() : [])]
              : await deps.adminIds();
          await deps.notify(recipients, {
            type: result.note.notify.type,
            title: result.note.notify.title,
            body: result.note.notify.body,
            ticketCode: fresh.code,
          });
        }
      }
    }
    return ids;
  }


  // The requester typed a message instead of tapping a button. If no staff member has
  // answered recently, understand it and reply automatically; otherwise stay quiet.
  async function autoReply({ code, user, text }) {
    const ctx = await loadContext(code, user);
    const { ticket } = ctx;
    if (["Cancelled"].includes(ticket.status)) return [];
    const [active] = await query(
      `SELECT COUNT(*) AS n FROM ticket_messages m JOIN users u ON u.user_pk = m.sender_pk
       WHERE m.ticket_pk = ? AND m.kind = 'chat' AND u.role IN ('technician', 'admin')
         AND m.created_at > DATE_SUB(NOW(), INTERVAL 10 MINUTE)`,
      [ticket.ticket_pk],
    );
    if (Number(active.n) > 0) return [];

    const tl = isTagalog(text);
    const say = (value) => (tl ? toTagalog(value) : value);
    const choice = detectChoice(String(text), ticket.category);
    const botId = await getBotId();
    if (choice === "thanks") {
      const id = await insertMessage(ticket.ticket_pk, botId, say("You're welcome! 😊 Anything else I can help with?"), "bot", tl ? toTagalogOptions(mainMenu(ctx)) : mainMenu(ctx));
      return [id];
    }
    if (choice === "hello" || !choice || (choice === "fixedit" && ticket.status === "Resolved")) {
      const fallback = choice === "hello"
        ? `Hi ${ctx.firstName}! What can I help you with?`
        : "I'm not sure I understood that, but your message went to the team. In the meantime, here is what I can do:";
      const [last] = await query(
        "SELECT message_text FROM ticket_messages WHERE ticket_pk = ? AND kind = 'bot' ORDER BY message_pk DESC LIMIT 1",
        [ticket.ticket_pk],
      );
      if (choice !== "hello" && (last?.message_text.startsWith(fallback) || last?.message_text.startsWith(say(fallback)))) return [];
      return [await insertMessage(ticket.ticket_pk, botId, say(`${fallback}
${ctx.availability.anyOnline ? availabilityLine(ctx.availability) : "The team is offline right now and will reply when they're back."}`), "bot", tl ? toTagalogOptions(mainMenu(ctx)) : mainMenu(ctx))];
    }
    const real = choice === "fixedit" ? "fixed:generic" : choice;
    return execute(real, ctx, user, null, tl);
  }

  function registerBotRoutes(app, { wrap }) {
    // Who can chat right now (shown as a banner in the ticket conversation).
    app.get("/api/tickets/:id/availability", wrap(async (req, res) => {
      const access = await deps.ticketAccess(req.params.id, req.query.userId);
      if (access.error) return res.status(access.error[0]).json({ error: access.error[1] });
      const a = await staffAvailability(access.ticket.assigned_to);
      res.json({ ...a, message: availabilityLine(a) });
    }));

    app.post("/api/tickets/:id/bot", wrap(async (req, res) => {
      const access = await deps.ticketAccess(req.params.id, req.body?.userId);
      if (access.error) return res.status(access.error[0]).json({ error: access.error[1] });
      const { ticket: base, user, isOwner } = access;
      if (!isOwner) {
        return res.status(403).json({ error: "Only the person who submitted the ticket can use the assistant." });
      }
      const choice = String(req.body?.choice ?? "");
      if (!choice) return res.status(400).json({ error: "choice is required." });

      const ctx = await loadContext(base.code, user);
      const offered = choice === "menu" ? [opt("menu", "Show me the menu")] : await lastOffered(ctx.ticket.ticket_pk);
      const picked = offered.find((item) => item.id === choice);
      if (!picked) {
        return res.status(409).json({ error: "That option is no longer available. Open the menu to start again." });
      }

      const ids = await execute(choice, ctx, user, picked.label);
      res.status(201).json({ messages: await loadMessages(ids, { staff: false }) });
    }));
  }

  return { registerBotRoutes, postGreeting, postResolvedPrompt, autoReply };
}

export { MESSAGE_SELECT };
