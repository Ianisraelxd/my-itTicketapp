// Which icon goes with each assistant option (the server sends plain labels, the page adds the icon).
export function chipIcon(id = "") {
  const key = id.split(":")[0];
  const map = {
    status: "pin",
    fix: "wrench",
    time: "clock",
    urgent: "siren",
    human: "user",
    more: "bulb",
    menu: "home",
    fixed: "checkCircle",
    kbyes: "checkCircle",
    notfixed: "xCircle",
    kbno: "xCircle",
    kbsearch: "book",
    kb: "file",
    rate: "star",
    reopen: "undo",
    cancel: "x",
    faq: "info",
  };
  if (id === "fix") return "repeat";
  return map[key] || null;
}
