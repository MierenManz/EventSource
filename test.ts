import { EventSource } from "./mod.ts";
const s = new EventSource("http://localhost:8000");
s.onmessage = (e) => {
  console.log("ree", e.data);
};
s.onerror = (e) => {
  console.log(e);
};
s.addEventListener("error", console.log);
