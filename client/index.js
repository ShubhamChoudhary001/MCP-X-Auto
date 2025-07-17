import { config } from 'dotenv';
import { GoogleGenAI } from "@google/genai";
import readline from 'readline/promises';
import fetch from 'node-fetch';
import fs from 'fs';
import schedule from 'node-schedule';
import path from 'path';

config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function logErrorToFile(error) {
    const timestamp = new Date().toISOString();
    const message = error && error.message ? error.message : String(error);
    const stack = error && error.stack ? error.stack : '';
    const logEntry = `[${timestamp}] ERROR: ${message}\n${stack}\n\n`;
    fs.appendFileSync('error_log.txt', logEntry);
}

async function generateContentWithRetry(prompt, retries = 6, delayMs = 5000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await ai.models.generateContent({
                model: "gemini-2.0-flash",
                contents: [{ role: "user", parts: [{ text: prompt }] }]
            });
            return response;
        } catch (err) {
            if (err.message && err.message.includes('503') && i < retries - 1) {
                console.warn(`503 error received. Retrying in ${delayMs / 1000} seconds... (${i + 1}/${retries})`);
                await new Promise(res => setTimeout(res, delayMs));
            } else {
                throw err;
            }
        }
    }
}

async function chatMode() {
    console.log("\nEntering chat mode. Type 'exit' or 'quit' to leave.\n");
    let history = [];
    while (true) {
        const userMsg = await rl.question('You: ');
        if (["exit", "quit"].includes(userMsg.trim().toLowerCase())) {
            console.log("Exiting chat mode.\n");
            break;
        }
        // Add user message to history
        history.push({ role: "user", parts: [{ text: userMsg }] });
        try {
            // Send full history for context
            const response = await ai.models.generateContent({
                model: "gemini-2.0-flash",
                contents: history
            });
            const aiMsg = response.candidates[0].content.parts[0].text;
            console.log("AI:", aiMsg, "\n");
            // Add AI response to history for context
            history.push({ role: "model", parts: [{ text: aiMsg }] });
        } catch (err) {
            logErrorToFile(err);
            console.error("AI error:", err.message);
        }
    }
}

function saveTweetToHistory(tweetText) {
    const timestamp = new Date().toISOString();
    let history = [];
    try {
        if (fs.existsSync('tweet_history.json')) {
            history = JSON.parse(fs.readFileSync('tweet_history.json', 'utf-8'));
        }
    } catch (e) {
        // ignore parse errors, start fresh
    }
    history.push({ tweet: tweetText, timestamp });
    fs.writeFileSync('tweet_history.json', JSON.stringify(history, null, 2));
}

async function viewTweetHistory() {
    let history = [];
    try {
        if (fs.existsSync('tweet_history.json')) {
            history = JSON.parse(fs.readFileSync('tweet_history.json', 'utf-8'));
        }
    } catch (e) {
        console.log('Could not read tweet history.');
        return;
    }
    if (history.length === 0) {
        console.log('No tweets in history.');
        return;
    }
    for (let i = 0; i < history.length; i++) {
        console.log(`\n[${i + 1}] (${history[i].timestamp})\n${history[i].tweet}`);
    }
    const action = await rl.question('\nEnter tweet number to re-post, (s)earch, or press Enter to return: ');
    if (action.trim() === '') return;
    if (action.toLowerCase() === 's') {
        const query = await rl.question('Enter search text: ');
        const results = history.filter(h => h.tweet.toLowerCase().includes(query.toLowerCase()));
        if (results.length === 0) {
            console.log('No matching tweets found.');
        } else {
            for (let i = 0; i < results.length; i++) {
                console.log(`\n[${i + 1}] (${results[i].timestamp})\n${results[i].tweet}`);
            }
        }
        await rl.question('Press Enter to return.');
        return;
    }
    const idx = parseInt(action.trim());
    if (!isNaN(idx) && idx > 0 && idx <= history.length) {
        const tweetText = history[idx - 1].tweet;
        const confirm = await rl.question(`\nReady to re-post this tweet? (y/n):\n${tweetText}\n`);
        if (confirm.toLowerCase() === 'y') {
            try {
                const res = await fetch('http://localhost:3001/create-post', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: tweetText })
                });
                const result = await res.json();
                console.log(result.message);
                saveTweetToHistory(tweetText); // Save re-post
            } catch (err) {
                logErrorToFile(err);
                console.error('Failed to post tweet:', err.message);
            }
        } else {
            console.log('Tweet not posted.');
        }
    }
}

async function suggestHashtagsAndMentions(tweetText) {
    try {
        const suggestionPrompt = `Suggest up to 3 relevant hashtags and up to 2 relevant Twitter mentions for this tweet. Only output a comma-separated list (e.g., #AI, #Tech, @OpenAI):\n${tweetText}`;
        const response = await generateContentWithRetry(suggestionPrompt);
        let suggestion = response.candidates[0].content.parts[0].text.trim();
        // Clean up: remove any extra text, keep only the first line
        suggestion = suggestion.split('\n')[0];
        return suggestion;
    } catch (err) {
        logErrorToFile(err);
        return '';
    }
}

function saveScheduledTweet(tweetText, dateTime) {
    let scheduled = [];
    try {
        if (fs.existsSync('scheduled_tweets.json')) {
            scheduled = JSON.parse(fs.readFileSync('scheduled_tweets.json', 'utf-8'));
        }
    } catch (e) {
        // ignore parse errors, start fresh
    }
    scheduled.push({ tweet: tweetText, dateTime });
    fs.writeFileSync('scheduled_tweets.json', JSON.stringify(scheduled, null, 2));
}

async function tweetMode() {
    let continuePosting = true;
    while (continuePosting) {
        const userPrompt = await rl.question('What should the tweet be about? ');
        const tone = await rl.question('What tone or sentiment should the tweet have? (e.g., funny, professional, inspirational, positive, etc.): ');
        const prompt = `Write a tweet (max 280 characters) about: ${userPrompt}\nTone/Sentiment: ${tone}`;
        let tweetText = '';
        let generated = false;
        let response;
        let mediaPath = '';
        while (!generated) {
            try {
                response = await generateContentWithRetry(prompt);
            } catch (err) {
                logErrorToFile(err);
                if (err.message && err.message.includes('503')) {
                    console.error('The model is overloaded and not responding after several attempts. Please try again later. Returning to main menu.');
                    return;
                } else {
                    console.error('An error occurred:', err.message);
                    return;
                }
            }
            tweetText = response.candidates[0].content.parts[0].text;
            if (tweetText.length > 280) {
                console.log("Warning: The generated tweet is too long and will be truncated to 280 characters.\n");
                tweetText = tweetText.slice(0, 280);
            }
            // Hashtag and mention suggestion
            const suggestions = await suggestHashtagsAndMentions(tweetText);
            let hashtagsMentions = '';
            if (suggestions) {
                console.log(`\nSuggested hashtags/mentions: ${suggestions}`);
                hashtagsMentions = await rl.question('Edit hashtags/mentions or press Enter to accept: ');
                if (!hashtagsMentions.trim()) {
                    hashtagsMentions = suggestions;
                }
            }
            if (hashtagsMentions) {
                // Add hashtags/mentions to tweet, ensuring total length <= 280
                let combined = tweetText + ' ' + hashtagsMentions;
                if (combined.length > 280) {
                    console.log("Warning: Adding hashtags/mentions exceeds 280 characters. Truncating tweet text.");
                    tweetText = tweetText.slice(0, 280 - hashtagsMentions.length - 1);
                    combined = tweetText + ' ' + hashtagsMentions;
                }
                tweetText = combined.trim();
            }
            // Media support with file existence check
            const wantMedia = await rl.question('Do you want to attach an image, GIF, or video? (y/n): ');
            if (wantMedia.trim().toLowerCase() === 'y') {
                while (true) {
                    mediaPath = await rl.question('Enter the file path for the image, GIF, or video: ');
                    if (!mediaPath.trim()) {
                        mediaPath = '';
                        break;
                    }
                    const resolvedPath = path.resolve(mediaPath);
                    if (fs.existsSync(resolvedPath)) {
                        mediaPath = resolvedPath;
                        break;
                    } else {
                        console.log('File does not exist. Please enter a valid file path or press Enter to skip attaching media.');
                    }
                }
            } else {
                mediaPath = '';
            }
            console.log("\nGenerated tweet:\n" + tweetText + (mediaPath ? `\n[Media: ${mediaPath}]` : '') + "\n");
            const action = await rl.question('What would you like to do? (a)ccept and post, (e)dit, (r)egenerate, (c)ancel: ');
            if (action.toLowerCase() === 'a') {
                generated = true;
            } else if (action.toLowerCase() === 'e') {
                tweetText = await rl.question('Edit the tweet as you like:\n');
                if (tweetText.length > 280) {
                    console.log("Warning: Your edited tweet is too long and will be truncated to 280 characters.\n");
                    tweetText = tweetText.slice(0, 280);
                }
                // Optionally allow editing mediaPath as well
                const editMedia = await rl.question('Edit media file path or press Enter to keep current: ');
                if (editMedia.trim()) {
                    const resolvedEdit = path.resolve(editMedia.trim());
                    if (fs.existsSync(resolvedEdit)) {
                        mediaPath = resolvedEdit;
                    } else {
                        console.log('File does not exist. Keeping previous media path.');
                    }
                }
                generated = true;
            } else if (action.toLowerCase() === 'r') {
                console.log('Regenerating tweet...');
            } else if (action.toLowerCase() === 'c') {
                console.log('Cancelled.');
                return;
            } else {
                console.log('Invalid option. Please choose again.');
            }
        }
        // Confirm before posting
        const confirm = await rl.question(`\nReady to post this tweet? (y/n):\n${tweetText}${mediaPath ? `\n[Media: ${mediaPath}]` : ''}\n`);
        if (confirm.toLowerCase() === 'y') {
            const scheduleOrNow = await rl.question('Post now or schedule for later? (now/schedule): ');
            if (scheduleOrNow.trim().toLowerCase() === 'schedule') {
                let dateTime = await rl.question('Enter date and time for tweet (YYYY-MM-DD HH:mm, 24h): ');
                // Validate date/time
                const parsed = new Date(dateTime.replace(' ', 'T'));
                if (isNaN(parsed.getTime()) || parsed < new Date()) {
                    console.log('Invalid or past date/time. Tweet not scheduled.');
                } else {
                    scheduleTweet({ tweetText, mediaPath }, parsed);
                }
            } else {
                // Send to backend to post on Twitter
                try {
                    const res = await fetch('http://localhost:3001/create-post', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: tweetText, mediaPath })
                    });
                    const result = await res.json();
                    console.log(result.message);
                    saveTweetToHistory(tweetText);
                } catch (err) {
                    logErrorToFile(err);
                    console.error('Failed to post tweet:', err.message);
                }
            }
        } else {
            console.log('Tweet not posted.');
        }
        // Ask if the user wants to post another tweet
        const again = await rl.question('\nDo you want to post another tweet? (y/n): ');
        if (again.toLowerCase() !== 'y') {
            continuePosting = false;
        }
    }
}

// Update scheduleTweet to accept an object with tweetText and mediaPath
function scheduleTweet({ tweetText, mediaPath }, dateTime) {
    schedule.scheduleJob(new Date(dateTime), async function() {
        try {
            const res = await fetch('http://localhost:3001/create-post', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: tweetText, mediaPath })
            });
            const result = await res.json();
            console.log(`[Scheduled] ${result.message}`);
            saveTweetToHistory(tweetText);
        } catch (err) {
            logErrorToFile(err);
            console.error('[Scheduled] Failed to post tweet:', err.message);
        }
    });
    saveScheduledTweet(tweetText, dateTime);
    console.log(`Tweet scheduled for ${dateTime}`);
}

async function mainMenu() {
    while (true) {
        const mode = await rl.question("What would you like to do? (1) Post a tweet, (2) Chat with AI, (3) Tweet history, (q) Quit: ");
        if (mode.trim() === '1') {
            await tweetMode();
        } else if (mode.trim() === '2') {
            await chatMode();
        } else if (mode.trim() === '3') {
            await viewTweetHistory();
        } else if (mode.trim().toLowerCase() === 'q') {
            console.log("Goodbye!");
            rl.close();
            process.exit(0);
        } else {
            console.log("Invalid option. Please choose 1, 2, 3, or q.");
        }
    }
}

mainMenu();

