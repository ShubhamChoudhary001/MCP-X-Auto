import { config } from "dotenv"
import { TwitterApi } from "twitter-api-v2"
import fs from "fs";
config()

const twitterClient = new TwitterApi({
    appKey: process.env.TWITTER_API_KEY,
    appSecret: process.env.TWITTER_API_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET
})

export async function createPost(status, mediaPath) {
    let mediaId = undefined;
    if (mediaPath) {
        // Read file and upload to Twitter
        try {
            const mediaData = fs.readFileSync(mediaPath);
            // TwitterApi v2 does not support media upload directly, so use v1.1 for media upload
            mediaId = await twitterClient.v1.uploadMedia(mediaData, { mimeType: getMimeType(mediaPath) });
        } catch (err) {
            throw new Error(`Failed to upload media: ${err.message}`);
        }
    }
    let newPost;
    if (mediaId) {
        newPost = await twitterClient.v2.tweet({ text: status, media: { media_ids: [mediaId] } });
    } else {
        newPost = await twitterClient.v2.tweet(status);
    }
    return {
        content: [
            {
                type: "text",
                text: `Tweeted: ${status}${mediaId ? ' [with media]' : ''}`
            }
        ]
    }
}

function getMimeType(filePath) {
    const ext = filePath.split('.').pop().toLowerCase();
    if (["jpg", "jpeg"].includes(ext)) return "image/jpeg";
    if (ext === "png") return "image/png";
    if (ext === "gif") return "image/gif";
    if (["mp4", "m4v"].includes(ext)) return "video/mp4";
    if (ext === "mov") return "video/quicktime";
    // Add more as needed
    return undefined;
}