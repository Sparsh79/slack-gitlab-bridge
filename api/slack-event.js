export default function handler(req, res) {
  console.log('Function called');
  
  if (req.body && req.body.type === 'url_verification') {
    return res.json({ challenge: req.body.challenge });
  }
  
  return res.json({ 
    message: 'Working!',
    method: req.method,
    timestamp: new Date().toISOString()
  });
}