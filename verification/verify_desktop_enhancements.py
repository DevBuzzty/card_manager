from playwright.sync_api import sync_playwright

def verify_desktop_enhancements():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.add_init_script("""
            window.api = {
                getDecks: async () => [{id: 1, name: 'Mock Deck'}],
                getCollection: async () => [
                    { id: '46986414', name: 'Dark Magician', type: 'Normal Monster', image_url: 'https://images.ygoprodeck.com/images/cards/46986414.jpg', atk: 2500, def: 2100, level: 7, race: 'Spellcaster', attribute: 'DARK', quantity: 3, price: 1.20, set_code: 'SDY-006' },
                    { id: '89631139', name: 'Blue-Eyes White Dragon', type: 'Normal Monster', image_url: 'https://images.ygoprodeck.com/images/cards/89631139.jpg', atk: 3000, def: 2500, level: 8, race: 'Dragon', attribute: 'LIGHT', quantity: 1, price: 50.00, set_code: 'LOB-001' }
                ],
                createDeck: async (name) => ({id: Date.now(), name: name}),
                saveDeck: async () => {},
                exportDeckYdk: async () => ({success: true}),
                getDeckDetails: async () => [],
                getIpAddress: async () => '127.0.0.1',
                onCardScanned: () => () => {},
                onUpdateProgress: () => () => {},
                updateAllCards: async () => ({success: true}),
                updateMissingCards: async () => ({success: true})
            };
        """)

        print("Navigating to http://localhost:5174")
        try:
            page.goto("http://localhost:5174", timeout=10000)
        except Exception as e:
            print(f"Navigation failed: {e}")
            page.screenshot(path="verification/error_nav.png")
            return

        print("Page title:", page.title())

        # Wait for app to load (look for "CARD DEX" sidebar header)
        try:
            page.wait_for_selector("text=CARD DEX", timeout=5000)
            print("App loaded.")
        except:
             print("App failed to load UI.")
             page.screenshot(path="verification/error_load.png")
             # Dump console logs if possible? (Hard in sync playwright without listener setup beforehand)
             return

        print("Navigating to Deck Builder...")
        try:
            page.get_by_text("Deck Builder", exact=False).click(timeout=5000)
        except Exception as e:
            print(f"Click Deck Builder failed: {e}")
            page.screenshot(path="verification/error_click.png")
            return

        # Check if we are on deck builder
        if page.get_by_text("My Decks").is_visible():
            print("Entered Deck Builder.")
        else:
            print("Failed to enter Deck Builder.")
            page.screenshot(path="verification/error_deckbuilder.png")
            return

        print("Selecting Mock Deck...")
        try:
            page.get_by_text("Mock Deck").click(timeout=5000)
        except:
             print("Mock Deck not found or clickable.")
             page.screenshot(path="verification/error_mockdeck.png")
             return

        print("Verifying Export button...")
        if page.get_by_text("Export YDK").is_visible():
            print("Export YDK button found.")
        else:
            print("Error: Export YDK button not found.")
            page.screenshot(path="verification/error_export.png")

        print("Toggling Stats...")
        try:
            stats_btn = page.locator('button[title="Toggle Stats"]')
            stats_btn.click()
            # Wait for charts to appear. Recharts usually animates, so wait a bit.
            page.wait_for_timeout(1000)

            # Check for SVG elements which Recharts uses
            if page.locator("svg.recharts-surface").count() > 0:
                print("Charts visible.")
            else:
                print("Charts NOT visible.")

            page.screenshot(path="verification/deck_builder_stats.png")
            print("Screenshot saved: verification/deck_builder_stats.png")
        except Exception as e:
            print(f"Error toggling stats: {e}")
            page.screenshot(path="verification/error_stats.png")

        print("Navigating to My Collection...")
        page.get_by_text("My Collection").click()
        page.wait_for_timeout(1000)

        print("Verifying filters...")

        # Filter existence checks
        # CustomSelect with placeholder/default value
        if page.get_by_text("All Attr").is_visible():
            print("Attribute filter found.")
        else:
            print("Attribute filter NOT found.")

        if page.get_by_text("All Races").is_visible():
            print("Race filter found.")
        else:
            print("Race filter NOT found.")

        if page.get_by_text("All Sets").is_visible():
            print("Set filter found.")
        else:
            print("Set filter NOT found.")

        page.screenshot(path="verification/collection_filters.png")
        print("Screenshot saved: verification/collection_filters.png")

        browser.close()

if __name__ == "__main__":
    verify_desktop_enhancements()
