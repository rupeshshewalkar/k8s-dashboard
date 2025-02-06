// Check Authentication
async function checkAuthentication() {
    try {
        const response = await fetch('/api/v1/authcheck');
        if (!response.ok) {
            window.location.href = '/';
            return null;
        }
        const data = await response.json();
        return data.user; // Get username from response
    } catch (error) {
        window.location.href = '/';
        return null;
    }
}
// Add username display function
function displayUsername(username) {
    const usernameElement = document.getElementById("usernameDisplay");
    if (usernameElement && username) {
        usernameElement.textContent = username;
    }
}