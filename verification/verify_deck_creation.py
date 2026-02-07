from playwright.sync_api import sync_playwright

def verify_deck_creation():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.add_init_script("""
            window.api = {
                getDecks: async () => [],
                getCollection: async () => [],
                createDeck: async (name) => ({id: Date.now(), name: name}),
                saveDeck: async () => {},
                exportDeckYdk: async () => {},
                getDeckDetails: async () => [],
                getIpAddress: async () => '127.0.0.1',
                onCardScanned: () => () => {},
                onUpdateProgress: () => () => {},
                updateAllCards: async () => ({success: true}),
                updateMissingCards: async () => ({success: true}),
                checkCardExists: async () => ({exists: false}),
                getPortfolio: async () => ({totalValue: 0, totalCards: 0, uniqueCards: 0}),
                getPriceHistory: async () => [],
                updateCardMeta: async () => ({success: true}),
                deleteDeck: async () => {},
                importDeckYdk: async () => ({canceled: true})
            };
        """)

        print("Navigating to http://localhost:5174")
        try:
            page.goto("http://localhost:5174", timeout=10000)
        except Exception as e:
            print(f"Navigation failed: {e}")
            return

        # Wait for app to load
        try:
            page.wait_for_selector("text=CARD DEX", timeout=5000)
            print("App loaded.")
        except:
             print("App failed to load UI.")
             return

        print("Navigating to Deck Builder...")
        try:
            page.get_by_text("Deck Builder", exact=False).click(timeout=5000)
        except Exception as e:
            print(f"Click Deck Builder failed: {e}")
            return

        # Wait for "New Deck" button (plus icon)
        print("Clicking New Deck button...")
        try:
            btn = page.locator('button[title="New Deck"]')
            btn.wait_for(state="visible", timeout=5000)
            btn.click()
        except Exception as e:
             print(f"New Deck button not found or clickable: {e}")
             page.screenshot(path="verification/error_new_deck_btn.png")
             return

        # Verify input appears
        print("Verifying input field...")
        try:
            input_locator = page.get_by_placeholder("Deck Name...")
            input_locator.wait_for(state="visible", timeout=2000)
            print("Input field visible.")
        except:
            print("Input field NOT visible.")
            page.screenshot(path="verification/error_input.png")
            return

        # Type name
        deck_name = "Test Deck 123"
        print(f"Creating deck: {deck_name}")
        input_locator.fill(deck_name)

        # Click Create
        page.get_by_role("button", name="Create").click()

        # Verify deck appears (use first() to avoid strict mode error if multiple found)
        print("Verifying deck is visible...")
        try:
            deck_item = page.get_by_text(deck_name).first
            deck_item.wait_for(state="visible", timeout=2000)
            print(f"Deck '{deck_name}' found.")
        except:
            print(f"Deck '{deck_name}' NOT found.")
            page.screenshot(path="verification/error_deck_list.png")
            return

        page.screenshot(path="verification/deck_creation_success.png")
        print("Verification successful.")

        browser.close()

if __name__ == "__main__":
    verify_deck_creation()
