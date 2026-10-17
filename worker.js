export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const body = await request.json();
      const email = body.email || `trial_${Math.random().toString(36).substring(7)}`;

      // Берем токен из секретов Cloudflare (env.API_TOKEN), а не из кода
      const API_TOKEN = env.API_TOKEN; 
      if (!API_TOKEN) {
        throw new Error("API_TOKEN не задан в настройках Worker");
      }

      const API_URL = "http://us2.h1cloud.net:25686/api/create"; // Проверь эндпоинт в доке H1
      const INBOUND_ID = "ib_91e7f61456"; // Твой ID инбаунда

      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${API_TOKEN}`
        },
        body: JSON.stringify({
          name: email,
          days: 1,
          traffic_gb: 5,
          inbound_id: INBOUND_ID
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Ошибка панели H1");

      return new Response(JSON.stringify({ 
        success: true, 
        link: data.link || data.subscription_url || data.config 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });

    } catch (error) {
      return new Response(JSON.stringify({ success: false, error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
