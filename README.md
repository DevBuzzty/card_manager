# Yu-Gi-Oh! Card Manager & Scanner Companion

A hybrid system consisting of a Desktop Host Application (Electron/React) and a Mobile Companion App (Android/Kotlin). The mobile app scans Yu-Gi-Oh! cards (via OCR of the 8-digit passcode) and instantly sends them to the desktop app for management.

## 📁 Project Structure

*   `desktop/`: The Electron + React application.
*   `android/`: The Android Studio project source code.

---

## 🖥️ Desktop Application

The desktop app acts as the server. It displays scanned cards in a "Staging Area" and allows you to save them to a local SQLite database.

### Prerequisites
*   Node.js (v16 or higher)
*   npm

### Setup & Run
1.  Navigate to the desktop directory:
    ```bash
    cd desktop
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
    *Note: If you encounter issues with `better-sqlite3`, ensure you have build tools installed (Python, Visual Studio Build Tools on Windows, or `build-essential` on Linux).*

3.  Start the application (Development Mode):
    ```bash
    npm run electron:dev
    ```
    This will launch the React dev server and the Electron window.

### Build Executable (.exe)
To create a standalone executable (e.g., for Windows):
1.  Run the build command:
    ```bash
    npm run dist
    ```
2.  The output files (Installer and `.exe`) will be located in the `desktop/dist-electron` folder.

### Features
*   **Staging Area**: Shows real-time feeds of cards scanned by the phone.
*   **Collection**: View your saved cards.
*   **Socket Server**: Runs on port `4000` to listen for mobile connections.
*   **Database**: Stores cards locally in `userData/cards.db`.
*   **Portfolio**: Track the value of your collection with realtime charts and history.
*   **Deck Builder**: Build and manage decks (import .ydk supported).
*   **AI Assistant**: Interact with your collection using natural language.

### AI Assistant Setup
To use the AI Assistant features:
1.  Go to [Google AI Studio](https://aistudio.google.com/app/apikey) and get a free Gemini API Key.
2.  In the Desktop App, click on the **AI Assistant** tab.
3.  Click the **Settings (Gear)** icon in the top right.
4.  Paste your API Key and click **Save**.

---

## 📱 Android Application

The mobile app uses the camera to detect card passcodes using Google ML Kit and sends them to the desktop via WebSockets.

### Prerequisites
*   Android Studio Hedgehog or newer.
*   An Android device (Physical device recommended for Camera testing).

### Import & Build
1.  Open **Android Studio**.
2.  Select **Open** and choose the `android` folder in this repository.
3.  Allow Gradle to sync and download dependencies.
4.  Connect your Android device via USB.
5.  Click **Run** (Play button).

### Usage
1.  **Connect**: On the start screen, enter the **IP Address** displayed in the Desktop App's sidebar (bottom left). Click "Connect".
2.  **Scan**: Point the camera at a Yu-Gi-Oh! card. Align the card within the frame.
3.  **Send**: The app automatically detects the 8-digit passcode. When detected, it sends the code to the desktop and shows a "Detected" message.

---

## 🔧 troubleshooting

*   **Connection Failed**: Ensure both devices are on the same Wi-Fi network. Check if your computer's firewall is blocking port `4000`.
*   **Camera Not Working**: Check App Permissions in Android Settings.
*   **Card Not Found**: The desktop app uses the YGOPRODeck API. Ensure the internet is active on the desktop.
