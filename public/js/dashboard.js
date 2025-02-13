// Initialize DOM Elements
const elements = {
    namespace: document.getElementById("namespace"),
    resourceType: document.getElementById("resourceType"),
    hotContainer: document.getElementById("hot-container")
};

let hot; // Handsontable instance
let resourceData = []; // Store resources data

// UI Object
const ui = {
    populateNamespaces: function(namespaces) {
        const namespaceSelect = elements.namespace;
        namespaceSelect.innerHTML = ""; // Clear existing options
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
                width: 50
            },
            { data: 'namespace', width: 120 },
            { data: 'resourceType', width: 100 },
            { data: 'name' },
            {
                data: 'labels',
                renderer: labelsRenderer,
                filter: 'multi_select',
                filterParams: {
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
        manualRowMove: true,
        licenseKey: 'non-commercial-and-evaluation',
        afterChange: (changes) => {
            if (changes && changes[0][1] === 'selected') {
                updateRowHighlight(changes[0][0]);
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

// Handle Search Function
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
            selected: false 
        }));
        updateHandsontable();
        applyStatusHighlighting();
    } catch (error) {
        console.error("Search error:", error);
        alert("Error fetching resources");
    }
}

// Fetch Resources
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

// Fetch Deployments
async function fetchDeployments(namespace) {
    try {
        const response = await fetch(`/api/v1/deployments/namespace/${namespace}`);
        if (!response.ok) throw new Error("Error fetching deployments");
        return await response.json();
    } catch (error) {
        console.error("Error getting deployments:", error);
        return [];
    }
}

// Fetch StatefulSets
async function fetchStatefulSets(namespace) {
    try {
        const response = await fetch(`/api/v1/statefulsets/namespace/${namespace}`);
        if (!response.ok) throw new Error("Error fetching stateful sets");
        return await response.json();
    } catch (error) {
        console.error("Error getting stateful sets:", error);
        return [];
    }
}

// Fetch Pods
async function fetchPods(namespace) {
    try {
        const response = await fetch(`/api/v1/pods/namespace/${namespace}`);
        if (!response.ok) throw new Error("Error fetching pods");
        return await response.json();
    } catch (error) {
        console.error("Error getting pods:", error);
        return [];
    }
}

// Update Handsontable
function updateHandsontable() {
    hot.updateSettings({
        data: resourceData,
        columns: getColumnsConfig()
    });
    hot.render();
}

// Get Columns Configuration
function getColumnsConfig() {
    const baseColumns = [
        {
            type: 'checkbox',
            className: 'checkbox-header',
            width: 50
        },
        { data: 'namespace', width: 120 },
        { data: 'resourceType', width: 100 },
        { data: 'name' },
        {
            data: 'labels',
            renderer: labelsRenderer,
            filter: 'multi_select',
            filterParams: {
                options: getLabelFilterOptions
            }
        }
    ];

    // Add type-specific columns
    if (elements.resourceType.value === 'pod') {
        return [...baseColumns, 
            { data: 'ready' }, 
            { data: 'status' },
            { data: 'restarts' },
            { data: 'age' }
        ];
    }
    return [...baseColumns,
        { data: 'ready' },
        { data: 'up_to_date' },
        { data: 'age' }
    ];
}

// Labels Renderer
function labelsRenderer(instance, td, row, col, prop, value) {
    td.innerHTML = formatLabelsForTable(value);
    return td;
}

// Format Labels for Table
function formatLabelsForTable(labels) {
    return Object.entries(labels || {}).map(([key, val]) => 
        `<span class="label-pill">${key}:${val}</span>`
    ).join('');
}

// Get Label Filter Options
function getLabelFilterOptions(column) {
    const labelsSet = new Set();
    resourceData.forEach(row => {
        Object.entries(row.labels || {}).forEach(([key, val]) => {
            labelsSet.add(`${key}:${val}`);
        });
    });
    return Array.from(labelsSet).sort();
}

// Perform Rollout Restart
async function performRolloutRestart() {
    const selectedRows = resourceData.filter(row => row.selected);
    if (selectedRows.length === 0) {
        alert("Please select resources to restart");
        return;
    }

    if (!confirm(`Restart ${selectedRows.length} selected resources?`)) return;

    for (const row of selectedRows) {
        const endpoint = `/${row.resourceType.toLowerCase()}s/${row.namespace}/rollout/${row.name}`;
        try {
            await fetch(endpoint, { method: 'POST' });
        } catch (error) {
            console.error("Restart failed:", error);
            alert(`Failed to restart ${row.name}`);
        }
    }
    
    alert("Rollout initiated. Refreshing data...");
    await handleSearch();
}

// Apply Status Highlighting
function applyStatusHighlighting() {
    resourceData.forEach((row, index) => {
        if (isResourceUpdating(row, row.resourceType)) {
            hot.setCellMeta(index, 3, 'className', 'updating-row');
        }
    });
}

// Determine if a resource is still updating
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

// Initialize Function
async function initialize() {
    const username = await checkAuthentication();
    const namespaces = await fetchNamespaces();
    ui.populateNamespaces(namespaces);
    initializeHandsontable();
    setupEventListeners();
    displayUsername(username);
}

document.addEventListener("DOMContentLoaded", initialize);