export const safeFilenamePrefix = (customerName: string) =>
  Array.from(customerName.trim())
    .filter((character) => character.charCodeAt(0) >= 32 && !'<>:"/\\|?*'.includes(character))
    .join("")
    .replace(/\s+/g, "_")
    .replace(/^\.+|\.+$/g, "") || "Customer";
