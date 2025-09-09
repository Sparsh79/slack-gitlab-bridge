export default async function handler(req, res) {
  console.log('Function called!', req.method);
  
  if (req.body?.type === 'url_verification') {
    return res.json({ challenge: req.body.challenge });
  }
  
  return res.json({ message: 'Working!', time: new Date().toISOString() });
}