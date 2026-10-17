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
      
      // Получаем UID пользователя из Firebase
      const uid = body.uid;
      if (!uid) throw new Error("Не передан UID пользователя");

      // Делаем имя на основе UID (убираем все лишнее, если есть)
      const safeName = `trial_${uid.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

      const API_TOKEN = env.API_TOKEN; 
      if (!API_TOKEN) throw new Error("API_TOKEN не задан в настройках");

      const API_BASE = "http://us2.h1cloud.net:25686/api"; 
      const INBOUND_ID = "ib_91e7f61456"; 

      // ⚡️ ПРОВЕРКА: Уже есть такой клиент?
      const checkResponse = await fetch(`${API_BASE}/clients/${safeName}`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${API_TOKEN}`
        }
      });

      // Если панель отвечает 200 OK, значит клиент уже существует
      if (checkResponse.ok) {
        throw new Error("Вы уже активировали пробный период. Оформите подписку, чтобы продолжить.");
      }

      // ⚡️ СОЗДАНИЕ: Если проверка не нашла клиента, создаем нового
      const response = await fetch(`${API_BASE}/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${API_TOKEN}`
        },
        body: JSON.stringify({
          name: safeName,            
          days: 1,                   
          traffic_limit_gb: 5,       
          device_limit: 2,           
          manual: true,              
          inbound_ids: [INBOUND_ID]  
        })
      });

      const data = await response.json();
      
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "Ошибка панели H1 при создании");
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
