## Google Cloud Credentials Setup

This project uses Google Cloud APIs and requires a service account key.

### Steps:

1. **Create a Service Account:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/).
   - Navigate to IAM & Admin > Service Accounts.
   - Click "Create Service Account", assign a name, and grant the necessary roles (e.g., Vertex AI User).
   - Click "Done".

2. **Download the Service Account Key:**
   - Click your new service account.
   - Go to the "Keys" tab.
   - Click "Add Key" > "Create new key" > Choose JSON > Download.

3. **Save the Key File:**
   - Save the JSON file somewhere safe on your computer.
   - **Do NOT upload this file to GitHub.**

4. **Set the Environment Variable:**
   - On Windows PowerShell:
     ```powershell
     $env:GOOGLE_APPLICATION_CREDENTIALS="C:\path\to\your\key.json"
     ```
   - On Mac/Linux:
     ```bash
     export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/key.json"
     ```

5. **Run the App:**
   - Make sure the environment variable is set in the same terminal session before running the app.

---

**Never share your service account key file publicly.** 