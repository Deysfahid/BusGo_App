const express = require('express')

const router = express.Router()

router.get('/', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'busgo-ai-api' })
})

module.exports = router
