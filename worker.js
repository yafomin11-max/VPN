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
      const email = body.email || 'unknown';
      
      // ⚡️ ГЕНЕРИРУЕМ БЕЗОПАСНОЕ ИМЯ (только буквы и цифры)
      const safeName = `trial_${Math.random().toString(36).substring(2, 8)}`;

      const API_TOKEN = env.API_TOKEN; 
      if (!API_TOKEN) throw new Error("API_TOKEN не задан в настройках");

      const API_URL = "http://us2.h1cloud.net:25686/api/create"; 
      const INBOUND_ID = "ib_91e7f61456"; // Твой ID инбаунда

      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${API_TOKEN}`
        },
        body: JSON.stringify({
          name: safeName,            // ⚡️ ИСПОЛЬЗУЕМ БЕЗОПАСНОЕ ИМЯ ВМЕСТО EMAIL
          days: 1,                   
          traffic_limit_gb: 5,       
          device_limit: 2,           
          manual: true,              
          inbound_ids: [INBOUND_ID]  
        })
      });

      const data = await response.json();
      
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "Ошибка панели H1");
      }

      const clientData = data.client || {};
      const link = clientData.sub_url || clientData.subscription_url;

      if (!link) {
        throw new Error("Панель не вернула ссылку");
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
