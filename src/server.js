const express = require('express')

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())

// Health check — used by Docker healthchecks and uptime monitors
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'astro-backend', time: new Date().toISOString() })
})

// API root
app.get('/api', (req, res) => {
  res.json({
    name: 'Vyotish-Astro Backend API',
    version: '0.1.0',
    endpoints: ['/health', '/api'],
  })
})

app.listen(PORT, () => {
  console.log(`astro-backend listening on port ${PORT}`)
})
