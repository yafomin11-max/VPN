# Партнёрская программа — как включить

## Что уже готово

**На сайте** (`js/referral.js`, `js/referral-net.js`):

- блок «Пригласите друга — неделя в подарок» перед подвалом;
- `?ref=CODE` запоминается на 30 дней;
- личная ссылка строится из email, копируется в один клик;
- счётчики читаются с воркера;
- пока воркер не отвечает на `/referral/stats`, бейдж сам показывает «скоро» —
  обещание не висит в воздухе;
- при входе сайт зовёт `POST /referral/me` (создать свой код) и `POST /referral/attach`
  (запомнить пригласившего). Основной Firebase-скрипт не тронут.

**В воркере** (`worker/referral.js`) — готовый модуль: три обработчика, начисление
через панель H1 и CORS. Осталось встроить и задеплоить.

## Как встроить (15 минут)

### 1. KV и переменные

```toml
# wrangler.toml
[[kv_namespaces]]
binding = "REFERRAL_KV"
id = "<id вашего namespace>"

[vars]
PANEL_URL = "https://<нода>.h1cloud.net:<порт>"
ALLOW_ORIGIN = "https://parallelogram.vpn"
```

```bash
wrangler secret put PANEL_API_TOKEN
```

Токен панели живёт только в воркере. Ключ кабинета `h1_…` его не заменяет.

### 2. Роутер

```js
import { handleStats, handleMe, handleAttach, preflight, creditSignup } from './referral.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return preflight(env);

    if (url.pathname === '/referral/stats') {
      return handleStats(env, url.searchParams.get('code'));
    }
    if (url.pathname === '/referral/me') {
      const user = await verifyFirebaseToken(request, env); // ваш существующий код
      return handleMe(env, user);
    }
    if (url.pathname === '/referral/attach') {
      const user = await verifyFirebaseToken(request, env);
      const body = await request.json().catch(() => ({}));
      return handleAttach(env, user, body.ref);
    }

    // ... остальные роуты
  }
};
```

`verifyFirebaseToken` — та же проверка, что у вас уже стоит на выдаче ключа.
Модуль ждёт от неё объект `{ uid, email }`.

### 3. Начисление при выдаче ключа

Сразу после того, как ключ выдан:

```js
await creditSignup(env, user, panelClientName);
```

`panelClientName` — как клиент записан в панели. Если не передать, модуль возьмёт email.
**Проверьте формат имени в своей панели** (`tg_12345`, `web_<uid>`…): от этого зависит,
куда уйдёт продление.

## Схема данных

| Ключ | Значение |
|---|---|
| `ref:user:{code}` | `{ email, invites, days }` |
| `ref:pending:{uid}` | код пригласившего, ждёт первого ключа |
| `ref:credited:{uid}` | код, по которому уже начислено |

`days` — накопленный бонус для случая, когда клиента в панели ещё нет:
примените его при создании клиента, иначе бонус потеряется.

## Начисление через панель H1

В `worker/referral.js` это функция `panelExtend()`. Ключевой момент: продлеваем
через **`expires_at`**, а не `days`.

```js
const current = Number(client.expires_at) || 0;
const base = Math.max(current, Math.floor(Date.now() / 1000));
const target = base + 7 * 86400;
// PATCH /api/clients/{name} { expires_at: target }
```

Почему так: `days` прибавляется при каждом вызове — таймаут и повтор дадут 14 дней
вместо 7. `expires_at` — абсолютная дата, повтор с тем же значением ничего не меняет.

Оговорки:

- `expires_at` в ответе панели — секунды. Если окажутся миллисекунды, поправьте в одном месте.
- **Федерация.** Общие изменения уходят на реплики, но документация советует проверять
  итоговый срок на каждой локации. Если не разъехалось — продлевайте точечно
  через `/api/fed/lproxy/{node_id}/clients/{name}`.
- **Не смешивайте с 3x-ui.** Там `days` — «новый срок от сейчас», `device_limit` нет.
- Если у пригласившего ещё нет клиента в панели, `panelExtend` бросит ошибку —
  модуль это ловит и копит `days` в KV.

## Проверка

```bash
curl "https://vpn.yafomin11.workers.dev/referral/stats?code=probe"
# {"invites":0,"days":0}
```

Затем перезагрузите сайт: бейдж должен стать «+7 дней · обоим» вместо «скоро».

Полный сценарий: залогиниться → `POST /referral/me` → перейти по чужой ссылке
в приватном окне → зарегистрироваться → получить ключ → в KV появится
`ref:credited:{uid}`, а срок пригласившего вырастет на 7 дней.

## Антифрод

- Считаем только после подтверждённого email и реально выданного ключа.
- Один приглашённый — одно начисление, самоприглашение запрещено на клиенте и сервере.
- `/referral/attach` стоит ограничить по частоте (5 попыток в час на uid).
- Пачка приглашений с одного IP за минуту — повод проверить вручную.

## Дальше

Конкурс с призовыми местами — отдельный слой поверх этой же схемы: счётчик `invites`
уже есть, останется добавить периоды и таблицу. Но включать его имеет смысл,
когда наберётся хотя бы полсотни активных.
