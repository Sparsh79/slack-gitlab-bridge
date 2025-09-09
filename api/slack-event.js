export default async function handler(req, res) {
  console.log('=== Function Called ===');
  console.log('Method:', req.method);
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  
  try {
    // Handle Slack URL verification challenge
    if (req.method === 'POST' && req.body) {
      console.log('POST request received');
      console.log('Body type:', req.body.type);
      console.log('Challenge:', req.body.challenge);
      
      if (req.body.type === 'url_verification') {
        console.log('URL verification request detected');
        const challenge = req.body.challenge;
        console.log('Responding with challenge:', challenge);
        
        return res.status(200).json({ 
          challenge: challenge 
        });
      }
      
      // Handle message events
      if (req.body.type === 'event_callback') {
        console.log('Event callback received');
        const event = req.body.event;
        
        if (event && event.type === 'message' && event.text) {
          console.log('Message event:', event.text);
          
          const text = event.text.toLowerCase();
          const isTestCommand = ['test', 'run test', 'run tests'].some(cmd => text.includes(cmd));
          
          if (isTestCommand) {
            console.log('Test command detected!');
            // For now, just log - we'll add GitLab trigger later
          }
        }
        
        return res.status(200).json({ success: true });
      }
    }
    
    // Handle GET requests (browser testing)
    if (req.method === 'GET') {
      return res.status(200).json({ 
        message: 'Slack GitLab Bridge is working!',
        timestamp: new Date().toISOString(),
        method: req.method
      });
    }
    
    // Default response
    return res.status(200).json({ 
      message: 'Request received',
      method: req.method,
      hasBody: !!req.body
    });
    
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}