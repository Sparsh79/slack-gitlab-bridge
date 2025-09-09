const crypto = require('crypto');

const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const GITLAB_PROJECT_ID = process.env.GITLAB_PROJECT_ID;
const GITLAB_TRIGGER_TOKEN = process.env.GITLAB_TRIGGER_TOKEN;
const GITLAB_URL = process.env.GITLAB_URL || 'https://gitlab.com';

const TEST_SUITES = {
  'unit': 'unit', 'integration': 'integration', 'e2e': 'e2e', 'end-to-end': 'e2e',
  'security': 'security', 'performance': 'performance', 'perf': 'performance',
  'all': 'all', 'full': 'all'
};

const TEST_ENVIRONMENTS = {
  'staging': 'staging', 'prod': 'production', 'production': 'production',
  'dev': 'development', 'development': 'development'
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
    if (text.includes(key)) { testSuite = value; break; }
  }
  
  let environment = 'staging';
  for (const [key, value] of Object.entries(TEST_ENVIRONMENTS)) {
    if (text.includes(key)) { environment = value; break; }
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
      body: JSON.stringify({ channel, text: message, as_user: true })
    });
    
    const result = await response.json();
    if (!result.ok) console.error('Slack API error:', result.error);
  } catch (error) {
    console.error('Error sending Slack message:', error.message);
  }
}

async function triggerGitLabTests(testConfig, slackUser, slackChannel) {
  const variables = {
    TRIGGERED_BY_SLACK: 'true',
    SLACK_USER: slackUser,
    SLACK_CHANNEL: slackChannel,
    TEST_SUITE: testConfig.testSuite,
    TEST_ENVIRONMENT: testConfig.environment
  };
  
  const response = await fetch(
    `${GITLAB_URL}/api/v4/projects/${GITLAB_PROJECT_ID}/trigger/pipeline`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: GITLAB_TRIGGER_TOKEN,
        ref: testConfig.branch,
        variables
      })
    }
  );
  
  if (!response.ok) throw new Error(`GitLab API error: ${response.status}`);
  return await response.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (req.body.type === 'url_verification') {
    return res.status(200).json({ challenge: req.body.challenge });
  }
  
  if (req.body.type === 'event_callback' && !verifySlackRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const { event } = req.body;
  
  if (event?.type === 'message' && !event.bot_id && event.text && event.channel?.startsWith('C')) {
    const testConfig = parseTestCommand(event.text);
    
    if (testConfig) {
      try {
        const pipeline = await triggerGitLabTests(testConfig, event.user, event.channel);
        
        const confirmationMessage = `Tests triggered by <@${event.user}>!\n` +
          `• Suite: ${testConfig.testSuite}\n` +
          `• Environment: ${testConfig.environment}\n` +
          `• Branch: ${testConfig.branch}\n` +
          `• Pipeline: ${pipeline.web_url}`;
        
        await sendSlackMessage(event.channel, confirmationMessage);
      } catch (error) {
        console.error('Failed to trigger tests:', error);
        await sendSlackMessage(event.channel, `Failed to trigger tests: ${error.message}`);
      }
    }
  }
  
  return res.status(200).json({ success: true });
}