from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()

        # Mock window.api
        page.add_init_script("""
            window.api = {
                getIpAddress: () => Promise.resolve('192.168.1.100'),
                onCardScanned: () => () => {},
                onUpdateProgress: () => () => {},
                getWishlist: () => Promise.resolve([]),
                searchOnline: (query) => Promise.resolve([]),
                addToWishlist: (card) => Promise.resolve({ success: true }),
                removeFromWishlist: (id) => Promise.resolve(true),
                getDecks: () => Promise.resolve([]),
                getCollection: () => Promise.resolve([
                    { id: '123', name: 'Blue-Eyes White Dragon', set_code: 'LOB-001', price: 100, quantity: 1, image_url: 'http://placeholder.com/img.jpg', rarity: 'Ultra Rare' }
                ]),
                checkCardExists: () => Promise.resolve({ exists: false, quantity: 0 }),
                getPortfolio: () => Promise.resolve({ totalValue: 1234.56, totalCards: 100, uniqueCards: 50 }),
                getPriceHistory: () => Promise.resolve([
                    { timestamp: new Date(Date.now() - 86400000).toISOString(), total_value: 1000 },
                    { timestamp: new Date().toISOString(), total_value: 1234.56 }
                ]),
                fetchCardData: (passcode) => Promise.resolve({}),
                addCardToDb: () => Promise.resolve({ success: true }),
                getSettings: () => Promise.resolve({}),
                saveSetting: () => Promise.resolve({ success: true }),
            };
        """)

        try:
            print("Navigating to app...")
            page.goto("http://localhost:5173")

            # Wait for Sidebar
            page.wait_for_selector("text=Yu-Gi-Oh! Manager", timeout=10000)
            print("SUCCESS: Sidebar found")

            # Click Portfolio
            print("Clicking Portfolio tab...")
            page.click("text=Portfolio")

            # Wait for Portfolio Header
            page.wait_for_selector("text=Total Portfolio Value", timeout=10000)
            print("SUCCESS: Portfolio Header found")

            # Check for specific elements
            total_value = page.locator("text=$1,234.56").first
            if total_value.is_visible():
                print("SUCCESS: Portfolio Value Displayed Correctly")
            else:
                print("FAILURE: Portfolio Value NOT found")

            # Take a screenshot
            page.screenshot(path="portfolio_screenshot.png")

        except Exception as e:
            print(f"Error loading page: {e}")
            page.screenshot(path="error_screenshot.png")

        browser.close()

if __name__ == "__main__":
    run()
