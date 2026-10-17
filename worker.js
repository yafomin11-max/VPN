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

      const API_TOKEN = env.API_TOKEN; 
      if (!API_TOKEN) throw new Error("API_TOKEN не задан в настройках");

      const API_URL = "http://us2.h1cloud.net:25686/api/create"; 
      const INBOUND_ID = "ib_91e7f61456"; // Твой ID инбаунда из старого конфига

      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${API_TOKEN}`
        },
        // ⚡️ ИСПРАВЛЕНО ПО ДОКУМЕНТАЦИИ
        body: JSON.stringify({
          name: email,
          days: 1,                   // 1 день
          traffic_limit_gb: 5,       // 5 ГБ
          device_limit: 2,           // 2 устройства
          manual: true,              // Принудительно используем наши инбаунды
          inbound_ids: [INBOUND_ID]  // Передаем массивом, как требует H1
        })
      });

      const data = await response.json();
      
      // H1 возвращает ok: false при ошибке
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "Ошибка панели H1");
      }

      // ⚡️ ИСПРАВЛЕНО: Ссылка лежит внутри объекта data.client
      const clientData = data.client || {};
      const link = clientData.sub_url || clientData.subscription_url;

      if (!link) {
        throw new Error("Панель не вернула ссылку на подписку");
      }

      return new Response(JSON.stringify({ 
        success: true, 
        link: link 
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
