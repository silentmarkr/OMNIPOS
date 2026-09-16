import re, subprocess

print("=== 1. CHECKING FOR SYNTAX ERRORS IN APP.JS ===")
try:
    res = subprocess.run(["node", "-c", "public/app.js"], capture_output=True, text=True)
    if res.returncode == 0:
        print("✅ OK: Walang syntax error sa app.js!")
    else:
        print("❌ CRITICAL SYNTAX ERROR SA APP.JS (Ito ang dahilan kung bakit ayaw gumana ng lahat ng JS):")
        print(res.stderr)
except Exception as e:
    print("ℹ️ Node syntax check skipped:", e)

print("\n=== 2. FORCE PATCHING openAddUserModal() ===")
with open("public/app.js", "r", encoding="utf-8") as f:
    content = f.read()

pattern = r"function\s+openAddUserModal\s*\(\s*\)[\s\S]*?^\}"

new_func = """function openAddUserModal() {
    console.log("👉 openAddUserModal triggered!");
    const modal = document.getElementById('user-modal');
    if (modal) {
        modal.style.display = 'flex';
    }
    try {
        userFormEditingUsername = null;
        if (document.getElementById('user-schema-form')) document.getElementById('user-schema-form').reset();
        if (typeof removeAvatarPhoto === 'function') removeAvatarPhoto('u-form-avatar','u-form-photo-preview');
        if (document.getElementById('user-modal-title')) document.getElementById('user-modal-title').innerText ='Add New User';
        if (document.getElementById('user-modal-submit-btn')) document.getElementById('user-modal-submit-btn').innerText ='Create Account';
        if (document.getElementById('u-form-username')) document.getElementById('u-form-username').disabled = false;
        if (document.getElementById('u-form-password')) document.getElementById('u-form-password').required = true;
        if (document.getElementById('u-form-password-label')) document.getElementById('u-form-password-label').innerText ='Password';
        if (typeof refreshUserFormRoleOptions === 'function') refreshUserFormRoleOptions();
    } catch(e) {
        console.error("Modal content reset warning:", e);
    }
}"""

if re.search(pattern, content, flags=re.MULTILINE):
    new_content = re.sub(pattern, new_func, content, flags=re.MULTILINE)
    with open("public/app.js", "w", encoding="utf-8") as f:
        f.write(new_content)
    print("✅ SUCCESS: Na-patch ang openAddUserModal!")
else:
    print("⚠️ WARN: Hindi nahanap ang openAddUserModal function pattern.")
