// Initialize DOM Elements
const elements = {
    namespace: document.getElementById("namespace"),
    resourceType: document.getElementById("resourceType"),
    hotContainer: document.getElementById("hot-container")
};

let hot;
let resourceData = [];

// UI Object
const ui = {
    populateNamespaces: function(namespaces) {
        const namespaceSelect = elements.namespace;
        namespaceSelect.innerHTML = "";
        if (namespaces.length === 0) {
            const option = document.createElement("option");
            option.value = "";
            option.textContent = "No namespaces available";
            namespaceSelect.appendChild(option);
            return;
        }
        namespaces.forEach(namespace => {
            const option = document.createElement("option");
            option.value = namespace;
            option.textContent = namespace;
            namespaceSelect.appendChild(option);
        });
    }
};

// Initialize Handsontable
function initializeHandsontable() {
    hot = new Handsontable(elements.hotContainer, {
        data: resourceData,
        colHeaders: ['Select', 'Namespace', 'Type', 'Name', 'Labels', 'Ready', 'Up-to-date', 'Age'],
        columns: [
            {
                type: 'checkbox',
                className: 'checkbox-header',
                width: 50,
                data: 'selected'
            },
            { data: 'namespace', width: 120 },
            { data: 'resourceType', width: 100 },
            { data: 'name' },
            {
                data: 'labels',
                renderer: labelsRenderer,
                filter: {
                    type: 'multi_select',
                    options: getLabelFilterOptions
                }
            },
            { data: 'ready', width: 100 },
            { data: 'up_to_date', width: 100 },
            { data: 'age', width: 80 }
        ],
        filters: true,
        dropdownMenu: true,
        width: '100%',
        height: '100%',
        rowHeaders: true,
        licenseKey: 'non-commercial-and-evaluation',
        afterChange: (changes, source) => {
            if (source === 'edit' && changes) {
                const [row, prop, oldValue, newValue] = changes[0];
                resourceData[row][prop] = newValue;
            }
        }
    });
}

// Event Listeners
function setupEventListeners() {
    document.getElementById("searchButton").addEventListener("click", handleSearch);
    document.getElementById("rolloutRestartButton").addEventListener("click", performRolloutRestart);

    document.getElementById('logoutButton').addEventListener('click', async function() {
        const response = await fetch('/logout', { method: 'POST' });
        if (response.ok) {
            window.location.href = '/';
        } else {
            alert('Logout failed');
        }
    });
}

async function handleSearch() {
    const namespace = elements.namespace.value.trim();
    const resourceType = elements.resourceType.value;
    
    if (!namespace) {
        alert("Please select a namespace.");
        return;
    }

    try {
        const data = await fetchResources(namespace, resourceType);
        resourceData = data.map(item => ({
            ...item,
            selected: false,
            labels: Object.entries(item.labels || {}).map(([k, v]) => `${k}:${v}`)
        }));
        updateHandsontable();
        applyStatusHighlighting();
    } catch (error) {
        console.error("Search error:", error);
        alert("Error fetching resources");
    }
}

async function fetchResources(namespace, resourceType) {
    const endpoints = {
        deployment: fetchDeployments,
        statefulset: fetchStatefulSets,
        pod: fetchPods
    };
    return endpoints[resourceType] ? await endpoints[resourceType](namespace) : [];
}

// Fetch Namespaces
async function fetchNamespaces() {
    try {
        const response = await fetch("/api/v1/namespaces/");
        if (!response.ok) throw new Error("Error fetching namespaces");
        const data = await response.json();
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error("Error getting namespaces:", error);
        return [];
    }
}

// Fetch Deployments with label transformation
async function fetchDeployments(namespace) {
    try {
        const response = await fetch(`/api/v1/deployments/namespace/${namespace}`);
        if (!response.ok) throw new Error("Error fetching deployments");
        const data = await response.json();
        return data.map(item => ({
            ...item,
            labels: transformLabels(item.labels)
        }));
    } catch (error) {
        console.error("Error getting deployments:", error);
        return [];
    }
}

// Fetch StatefulSets with label transformation
async function fetchStatefulSets(namespace) {
    try {
        const response = await fetch(`/api/v1/statefulsets/namespace/${namespace}`);
        if (!response.ok) throw new Error("Error fetching stateful sets");
        const data = await response.json();
        return data.map(item => ({
            ...item,
            labels: transformLabels(item.labels)
        }));
    } catch (error) {
        console.error("Error getting stateful sets:", error);
        return [];
    }
}

// Fetch Pods with label transformation
async function fetchPods(namespace) {
    try {
        const response = await fetch(`/api/v1/pods/namespace/${namespace}`);
        if (!response.ok) throw new Error("Error fetching pods");
        const data = await response.json();
        return data.map(item => ({
            ...item,
            labels: transformLabels(item.labels)
        }));
    } catch (error) {
        console.error("Error getting pods:", error);
        return [];
    }
}

// Transform labels object to array of "key:value" strings
function transformLabels(labels) {
    return Object.entries(labels || {}).map(([key, value]) => `${key}:${value}`);
}

// Update Handsontable
function updateHandsontable() {
    hot.updateData(resourceData);
}

function labelsRenderer(instance, td, row, col, prop, value) {
    td.innerHTML = formatLabelsForTable(value);
    td.style.whiteSpace = 'normal';
    return td;
}

function formatLabelsForTable(labels) {
    if (!labels || labels.length === 0) return 'No labels';
    
    const maxVisible = 3;
    const visibleLabels = labels.slice(0, maxVisible);
    const hiddenCount = labels.length - maxVisible;
    
    let html = visibleLabels.map(label => 
        `<div class="label-pill">${label}</div>`
    ).join('');

    if (hiddenCount > 0) {
        html += `<div class="text-muted">+${hiddenCount} more</div>`;
    }

    return html;
}

function getLabelFilterOptions(column) {
    const labelsSet = new Set();
    resourceData.forEach(row => {
        (row.labels || []).forEach(label => labelsSet.add(label));
    });
    return Array.from(labelsSet).sort();
}

async function performRolloutRestart() {
    const selectedRows = resourceData.filter(row => row.selected);
    if (selectedRows.length === 0) {
        alert("Please select resources to restart");
        return;
    }

    if (!confirm(`Restart ${selectedRows.length} selected resources?`)) return;

    const promises = selectedRows.map(async row => {
        const endpoint = `/api/v1/${row.resourceType.toLowerCase()}s/${row.namespace}/rollout/${row.name}`;
        try {
            const response = await fetch(endpoint, { method: 'POST' });
            return response.ok;
        } catch (error) {
            console.error("Restart failed:", error);
            return false;
        }
    });

    const results = await Promise.all(promises);
    const successCount = results.filter(status => status).length;
    
    alert(`Successfully restarted ${successCount}/${selectedRows.length} resources`);
    await handleSearch();
}

function applyStatusHighlighting() {
    hot.updateSettings({
        cells(row, col) {
            const cellProperties = {};
            const resource = resourceData[row];
            
            if (col === 3 && isResourceUpdating(resource, resource.resourceType)) {
                cellProperties.className = 'updating-row';
            }
            return cellProperties;
        }
    });
}

function isResourceUpdating(resource, resourceType) {
    switch (resourceType) {
        case "deployment":
            const [readyDeploy, totalDeploy] = resource.ready.split('/').map(Number);
            return readyDeploy !== totalDeploy;
        case "statefulset":
            const [readySS, totalSS] = resource.ready.split('/').map(Number);
            return readySS !== totalSS;
        case "pod":
            const [readyContainers, totalContainers] = resource.ready.split('/').map(Number);
            return resource.status !== "Running" || readyContainers !== totalContainers;
        default:
            return false;
    }
}

async function initialize() {
    const username = await checkAuthentication();
    const namespaces = await fetchNamespaces();
    ui.populateNamespaces(namespaces);
    initializeHandsontable();
    setupEventListeners();
    displayUsername(username);
}

document.addEventListener("DOMContentLoaded", initialize);