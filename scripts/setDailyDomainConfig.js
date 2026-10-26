import fetch from "node-fetch";

const API_KEY = "7b37265de84be2b4192b93b7e6046e93c11687712a80a23df1a8b8fb930efc5d";
const ROOM_NAME = "session_692d2a87993561163e0d20b1"; 

async function updateRoom() {
  const res = await fetch(`https://api.daily.co/v1/rooms/${ROOM_NAME}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      privacy: "private",
      properties: {
        enable_room_embed: true,
        allowed_embed_domains: [
          "http://localhost:5173",
          "https://shaadiundo.com",
          "https://www.shaadiundo.com"
        ]
      }
    }),
  });

  const data = await res.json();
  console.log("Response:", data);
}

updateRoom();
