// utils/sanitizer.js
const sanitizeHtml = require("sanitize-html");

function sanitizeInput(data) {
  if (typeof data === "string") {
    return sanitizeHtml(data, {
      allowedTags: [],       // block all HTML tags
      allowedAttributes: {}, // block all attributes
    });
  } else if (Array.isArray(data)) {
    return data.map(sanitizeInput);
  } else if (typeof data === "object" && data !== null) {
    const clean = {};
    for (const key in data) {
      clean[key] = sanitizeInput(data[key]);
    }
    return clean;
  }
  return data; // numbers, booleans untouched
}





module.exports = sanitizeInput;
