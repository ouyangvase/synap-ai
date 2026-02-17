# AgentHub Deployment Guide

## Local Development

### docker-compose.yml

```yaml
version: "3.8"

services:
  app:
    build: ./app
    ports:
      - "5173:5173"
    environment:
      - VITE_SUPABASE_URL=${SUPABASE_URL}
      - VITE_SUPABASE_PUBLISHABLE_KEY=${SUPABASE_ANON_KEY}
    depends_on:
      - n8n

  n8n:
    image: n8nio/n8n:latest
    ports:
      - "5678:5678"
    environment:
      - N8N_PUBLIC_API_DISABLED=true
      - N8N_ENCRYPTION_KEY=${N8N_ENCRYPTION_KEY}
      - WEBHOOK_URL=http://n8n:5678
    volumes:
      - n8n_data:/home/node/.n8n

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  n8n_data:
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SUPABASE_URL` | Your Cloud project URL | Yes |
| `SUPABASE_ANON_KEY` | Public anon key | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (backend only) | Yes |
| `LOVABLE_API_KEY` | Auto-provisioned AI gateway key | Yes (auto) |
| `N8N_ENCRYPTION_KEY` | Random 32-char string for n8n | Yes |
| `N8N_PUBLIC_API_DISABLED` | Disable n8n public API | Recommended |

## n8n Setup

1. Import workflow templates from `n8n/templates/*.json`
2. Each Webhook node must use **"Using Respond to Webhook node"** response mode
3. Register endpoint URLs in the `tool_endpoints` table

## n8n Security Baseline

- Set `N8N_PUBLIC_API_DISABLED=true`
- Set a strong `N8N_ENCRYPTION_KEY`
- Keep n8n >= 1.121.0 (patched)
- Use HTTPS in production
- Restrict webhook access via firewall/reverse proxy

## Production Checklist

- [ ] Enable HTTPS everywhere
- [ ] Configure proper CORS origins (replace `*`)
- [ ] Enable Supabase Auth email confirmation
- [ ] Set up database backups
- [ ] Monitor edge function logs
- [ ] Set up alerting for failed tool runs
- [ ] Review RLS policies
- [ ] Rotate secrets regularly

## Webhook Protocol

Tools receive:
```json
{
  "meta": {
    "tool_name": "echo",
    "tool_run_id": "uuid",
    "user_id": "uuid",
    "conversation_id": "uuid"
  },
  "input": { ... }
}
```

Tools must return:
```json
{
  "markdown_content": "...",
  "html_content": "...",
  "attachment_urls": [],
  "navigation_urls": []
}
```

## API Examples (curl)

### Login
```bash
curl -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password"}'
```

### Create Conversation
```bash
curl -X POST "$SUPABASE_URL/rest/v1/conversations" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"USER_UUID","title":"Test"}'
```

### Chat (SSE)
```bash
curl -N -X POST "$SUPABASE_URL/functions/v1/chat" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"conversation_id":"CONV_UUID"}'
```

### Execute Approved Tool
```bash
curl -X POST "$SUPABASE_URL/functions/v1/execute-tool" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tool_run_id":"RUN_UUID","conversation_id":"CONV_UUID"}'
```

### Test n8n Webhook
```bash
curl -X POST "http://localhost:5678/webhook/echo" \
  -H "Content-Type: application/json" \
  -d '{"meta":{"tool_name":"echo"},"input":{"message":"hello"}}'
```
