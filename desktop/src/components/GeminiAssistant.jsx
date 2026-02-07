import { useState, useEffect, useRef } from 'react';
import { Send, Bot, Settings, Key } from 'lucide-react';

export default function GeminiAssistant() {
  const [messages, setMessages] = useState([
    { role: 'model', text: 'Hello! I am your Yu-Gi-Oh! Collection Assistant. How can I help you today?' }
  ]);
  const [input, setInput] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (window.api) {
        window.api.getSettings().then(settings => {
            if (settings.gemini_api_key) {
                setApiKey(settings.gemini_api_key);
            } else {
                setShowSettings(true);
            }
        });
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const saveKey = async (key) => {
      if (!key.trim()) return;
      if (window.api) {
          await window.api.saveSetting('gemini_api_key', key.trim());
      }
      setApiKey(key.trim());
      setShowSettings(false);
  };

  const handleSend = async () => {
      if (!input.trim() || !apiKey) return;

      const userMsg = { role: 'user', text: input };
      setMessages(prev => [...prev, userMsg]);
      setInput('');
      setIsLoading(true);

      try {
          // Prepare context
          const collection = await window.api.getCollection();
          const context = `
            You are an assistant for a Yu-Gi-Oh Card Manager app.
            The user has a collection of ${collection.length} cards.
            Current Portfolio Value: $${collection.reduce((a,c) => a + (c.price||0)*c.quantity, 0).toFixed(2)}.

            Available Tools (you can output a JSON block to execute these):
            - add_card(passcode): Adds a card by passcode.
            - find_card(name): Returns cards matching name in collection.

            If the user asks to add a card, find its passcode (you are an expert) and output:
            \`\`\`json
            { "action": "add_card", "passcode": "89631139" }
            \`\`\`

            Keep responses concise.
          `;

          // Using the stable endpoint for gemini-pro
          const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=${apiKey}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  contents: [
                      { role: 'user', parts: [{ text: context + "\nUser: " + userMsg.text }] }
                  ]
              })
          });

          const data = await response.json();
          if (data.error) throw new Error(data.error.message);

          const replyText = data.candidates[0].content.parts[0].text;

          // Check for actions
          const jsonMatch = replyText.match(/```json\n([\s\S]*?)\n```/);
          let actionResult = null;

          if (jsonMatch) {
              try {
                  const command = JSON.parse(jsonMatch[1]);
                  if (command.action === 'add_card' && window.api) {
                      await window.api.fetchCardData(command.passcode); // Just to verify exists
                      await window.api.addCardToDb({ id: command.passcode, quantity: 1 }); // Basic add
                      actionResult = `Executed: Added card ${command.passcode}`;
                  }
              } catch (e) {
                  console.error("Action failed", e);
                  actionResult = "Failed to execute action.";
              }
          }

          setMessages(prev => [...prev, { role: 'model', text: replyText + (actionResult ? `\n\n[System] ${actionResult}` : '') }]);

      } catch (error) {
          setMessages(prev => [...prev, { role: 'model', text: `Error: ${error.message}` }]);
      } finally {
          setIsLoading(false);
      }
  };

  return (
    <div className="flex flex-col h-full bg-[#1E1E1E] rounded-2xl border border-gray-800 overflow-hidden relative">
        {/* Header */}
        <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-black/20">
            <div className="flex items-center gap-3">
                <div className="p-2 bg-space-violet/20 rounded-lg text-space-violet">
                    <Bot className="w-6 h-6" />
                </div>
                <div>
                    <h3 className="font-bold text-white">AI Assistant</h3>
                    <div className="flex items-center mt-1">
                        <div className={`w-2 h-2 rounded-full mr-2 ${apiKey ? 'bg-green-500' : 'bg-red-500'}`}></div>
                        <span className="text-xs text-gray-500">{apiKey ? 'Connected' : 'No API Key'}</span>
                    </div>
                </div>
            </div>
            <button onClick={() => setShowSettings(true)} className="p-2 text-gray-400 hover:text-white transition-colors">
                <Settings className="w-5 h-5" />
            </button>
        </div>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
            {messages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${msg.role === 'user' ? 'bg-space-violet text-white' : 'bg-gray-800 text-gray-200'}`}>
                        <p className="whitespace-pre-wrap text-sm">{msg.text}</p>
                    </div>
                </div>
            ))}
            {isLoading && (
                <div className="flex justify-start">
                    <div className="bg-gray-800 rounded-2xl px-4 py-3">
                        <div className="flex gap-1">
                            <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"></div>
                            <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce delay-100"></div>
                            <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce delay-200"></div>
                        </div>
                    </div>
                </div>
            )}
            <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-gray-800 bg-black/20">
            <div className="flex gap-2">
                <input
                    type="text"
                    placeholder="Ask me to add a card..."
                    className="flex-1 bg-[#1a1a1a] border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-space-violet transition-colors"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                />
                <button
                    onClick={handleSend}
                    disabled={isLoading || !apiKey}
                    className="p-3 bg-space-violet hover:bg-space-violet-dark text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    <Send className="w-5 h-5" />
                </button>
            </div>
        </div>

        {/* Settings Modal */}
        {showSettings && (
            <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-[#1E1E1E] w-full max-w-md p-6 rounded-2xl border border-gray-700 shadow-2xl">
                    <div className="flex items-center gap-3 mb-4 text-space-violet">
                        <Key className="w-6 h-6" />
                        <h3 className="text-xl font-bold text-white">Gemini API Configuration</h3>
                    </div>
                    <p className="text-gray-400 text-sm mb-6">
                        To use the AI Assistant, you need a Google Gemini API Key.
                        The key is stored locally on your device.
                    </p>
                    <input
                        type="password"
                        placeholder="Paste API Key here..."
                        className="w-full bg-black/40 border border-gray-600 rounded-lg px-4 py-3 text-white mb-6 focus:border-space-violet outline-none"
                        defaultValue={apiKey}
                        id="apiKeyInput"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                saveKey(e.target.value);
                            }
                        }}
                    />
                    <div className="flex justify-end gap-3">
                        <button onClick={() => setShowSettings(false)} className="px-4 py-2 text-gray-400 hover:text-white">Cancel</button>
                        <button
                            onClick={() => {
                                const inputVal = document.getElementById('apiKeyInput').value;
                                saveKey(inputVal);
                            }}
                            className="px-6 py-2 bg-space-violet text-white rounded-lg font-medium"
                        >
                            Save Key
                        </button>
                    </div>
                </div>
            </div>
        )}
    </div>
  );
}
