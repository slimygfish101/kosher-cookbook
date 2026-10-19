# Prompt for the one-time overnight accuracy check

Schedule with create_trigger: run_once_at = 4:00 AM America/New_York on the night after a batch is added,
create_new_session_on_fire = true, model = claude-sonnet-5-5, notifications = {push: true}. Prompt:

> Accuracy check for the family kosher cookbook (live app: https://kosher-cookbook.vercel.app), run overnight at the owner's request after a new batch of recipes was added. The owner asked for this check to use a multi-agent workflow (ultracode), and scheduled it for the night so it uses their Claude usage while they sleep.
>
> 1. Attach and clone the GitHub repository slimygfish101/kosher-cookbook (add_repo, then clone it), and read checks/PROCEDURE.md and tools/README.md.
> 2. Follow checks/PROCEDURE.md exactly: find recipes read from photos that are not yet in checks/checked.json, download their original photo copies from Supabase storage, re-read every title, ingredient, amount, unit, step, servings, section and Meat/Dairy/Pareve label independently with checker agents, confirm every difference with a second verifier look at the photo, and only then fix it in the Supabase database (using the publishable key in src/config.js). Truly unreadable items go on the "needs my help" list (needs_help = true with a plain-language reason). Never delete anything and never change the `original` column, labels, notes, or typed-in recipes.
> 3. Save progress after every small group (checks/checked.json and checks/log.md, commit and push to main). If usage runs out before everything is checked, schedule one more one-time run of this same check for 4:00 AM America/New_York the following night so it continues where it stopped.
> 4. If there is nothing new to check, just log that and stop without starting any agents.
> 5. Finish with a two-line plain-language summary (how many recipes and ingredients were checked, what was fixed, what needs the owner's help).
