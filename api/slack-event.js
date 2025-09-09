// api/slack-event.js - Complete Slack to GitLab integration
import crypto from 'crypto';

const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const GITLAB_PROJECT_ID = process.env.GITLAB_PROJECT_ID;
const GITLAB_TRIGGER_TOKEN = process.env.GITLAB_TRIGGER_TOKEN;
const GITLAB_URL = process.env.GITLAB_URL || 'https://gitlab.com';

const TEST_SUITES = {
  'unit': 'unit', 
  'integration': 'integration', 
  'e2e': 'e2e', 
  'end-to-end': 'e2e',
  'security': 'security', 
  'performance': 'performance', 
  'perf': 'performance',
  'all': 'all', 
  'full': 'all'
};

const TEST_ENVIRONMENTS = {
  'staging': 'staging', 
  'prod': 'production', 
  'production': 'production',
  'dev': 'development', 
  'development': 'development'
};

function verifySlackRequest(req) {
  const signature = req.headers['x-slack-signature'];
  const timestamp = req.headers['x-slack-request-timestamp'];
  const body = JSON.stringify(req.body);
  
  if (!signature || !timestamp) return false;
  
  const hmac = crypto.createHmac('sha256', SLACK_SIGNING_SECRET);
  const [version, hash] = signature.split('=');
  hmac.update(`${version}:${timestamp}:${body}`);
  
  return hmac.digest('hex') === hash;
}

function parseTestCommand(message) {
  const text = message.toLowerCase().trim();
  const testTriggers = ['test', 'run test', 'run tests', 'execute test'];
  const isTestCommand = testTriggers.some(trigger => text.includes(trigger));
  
  if (!isTestCommand) return null;
  
  let testSuite = 'all';
  for (const [key, value] of Object.entries(TEST_SUITES)) {
    if (text.includes(key)) { 
      testSuite = value; 
      break; 
    }
  }
  
  let environment = 'staging';
  for (const [key, value] of Object.entries(TEST_ENVIRONMENTS)) {
    if (text.includes(key)) { 
      environment = value; 
      break; 
    }
  }
  
  const branchMatch = text.match(/(?:branch|on)\s+(\w+)/);
  const branch = branchMatch ? branchMatch[1] : 'main';
  
  return { testSuite, environment, branch };
}

async function sendSlackMessage(channel, message) {
  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        channel, 
        text: message, 
        as_user: true 
      })
    });
    
    const result = await response.json();
    if (!result.ok) {
      console.error('Slack API error:', result.error);
    }
  } catch (error) {
    console.error('Error sending Slack message:', error.message);
  }
}

async function triggerGitLabTests(testConfig, slackUser, slackChannel) {

  console.log('Environment check:');
  console.log('GITLAB_PROJECT_ID:', process.env.GITLAB_PROJECT_ID);
  console.log('GITLAB_TRIGGER_TOKEN present:', !!process.env.GITLAB_TRIGGER_TOKEN);
  console.log('GITLAB_URL:', process.env.GITLAB_URL);
  console.log('SLACK_BOT_TOKEN present:', !!process.env.SLACK_BOT_TOKEN);

  const variables = {
    TRIGGERED_BY_SLACK: 'true',
    SLACK_USER: slackUser,
    SLACK_CHANNEL: slackChannel,
    TEST_SUITE: testConfig.testSuite,
    TEST_ENVIRONMENT: testConfig.environment
  };

  const requestBody = {
    token: GITLAB_TRIGGER_TOKEN,
    ref: testConfig.branch,
    variables
  };

  console.log('=== GitLab API Request Debug ===');
  console.log('URL:', `${GITLAB_URL}/api/v4/projects/${GITLAB_PROJECT_ID}/trigger/pipeline`);
  console.log('Project ID:', GITLAB_PROJECT_ID);
  console.log('Token present:', GITLAB_TRIGGER_TOKEN ? 'Yes' : 'No');
  console.log('Token starts with glptt:', GITLAB_TRIGGER_TOKEN?.startsWith('glptt-'));
  console.log('Request body:', JSON.stringify(requestBody, null, 2));
  console.log('================================');

  const response = await fetch(
    `${GITLAB_URL}/api/v4/projects/${GITLAB_PROJECT_ID}/trigger/pipeline`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    }
  );

  console.log('Response status:', response.status);
  console.log('Response headers:', Object.fromEntries(response.headers.entries()));

  if (!response.ok) {
    const errorText = await response.text();
    console.log('Full error response:', errorText);
    throw new Error(`GitLab API error: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

export default async function handler(req, res) {
  console.log('=== Function Called ===');
  console.log('Method:', req.method);
  console.log('Body type:', req.body?.type);
  
  try {
    // Handle Slack URL verification
    if (req.method === 'POST' && req.body?.type === 'url_verification') {
      console.log('URL verification request');
      return res.status(200).json({ 
        challenge: req.body.challenge 
      });
    }
    
    // Verify Slack request (only for event callbacks)
    if (req.body?.type === 'event_callback' && !verifySlackRequest(req)) {
      console.log('Slack verification failed');
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Handle message events
    if (req.body?.type === 'event_callback') {
      const event = req.body.event;
      console.log('Event received:', event?.type);
      
      if (event?.type === 'message' && !event.bot_id && event.text && event.channel?.startsWith('C')) {
        console.log('Processing message:', event.text);
        console.log('From user:', event.user);
        console.log('In channel:', event.channel);
        
        const testConfig = parseTestCommand(event.text);
        
        if (testConfig) {
          try {
            console.log(`Test command detected by ${event.user}:`, testConfig);
            
            const pipeline = await triggerGitLabTests(testConfig, event.user, event.channel);
            
            const confirmationMessage = `Tests triggered by <@${event.user}>!\n` +
              `• **Suite:** ${testConfig.testSuite}\n` +
              `• **Environment:** ${testConfig.environment}\n` +
              `• **Branch:** ${testConfig.branch}\n` +
              `• **Pipeline:** ${pipeline.web_url}`;
            
            await sendSlackMessage(event.channel, confirmationMessage);
            console.log('Pipeline triggered successfully:', pipeline.id);
            
          } catch (error) {
            console.error('Failed to trigger tests:', error);
            await sendSlackMessage(event.channel, `Failed to trigger tests: ${error.message}`);
          }
        } else {
          console.log('Not a test command, ignoring');
        }
      }
      
      return res.status(200).json({ success: true });
    }
    
    // Handle GET requests (browser testing)
    if (req.method === 'GET') {
      return res.status(200).json({ 
        message: 'Slack GitLab Bridge is working!',
        timestamp: new Date().toISOString(),
        status: 'ready'
      });
    }
    
    return res.status(200).json({ success: true });
    
  } catch (error) {
    console.error('Function error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}