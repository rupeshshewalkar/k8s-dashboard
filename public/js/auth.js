// Login page JS
document.getElementById('loginForm').onsubmit = async function(event) {
    event.preventDefault();
    const formData = new FormData();
    formData.append('kubeconfig', document.getElementById('kubeconfig').files[0]);
    const response = await fetch('/upload', {
        method: 'POST',
        body: formData
    });

    if (response.ok) {
        window.location.href = '/dashboard';
    } else {
        alert('Authentication failed');
    }
};