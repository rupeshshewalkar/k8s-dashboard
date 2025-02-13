// Initialize DOM Elements
const elements = {
    namespace: document.getElementById("namespace"),
    labelSearch: document.getElementById("labelSearch"),
    strict: document.getElementById("strict"),
    selectAll: document.getElementById("selectAll"),
    resourcesList: document.getElementById("resourcesList"),
    resourceType: document.getElementById("resourceType"),
    nameFilterDropdown: document.getElementById("nameFilterDropdown"),
    nameSearch: document.getElementById("nameSearch"),
    nameCheckboxes: document.getElementById("nameCheckboxes")
};

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

// Event Listeners
function setupEventListeners() {
    document.getElementById("searchButton").addEventListener("click", handleSearch);
    document.getElementById("rolloutRestartButton").addEventListener("click", performRolloutRestart);
    
    // Namespace and resource type change listeners
    elements.namespace.addEventListener('change', updateNameFilters);
    elements.resourceType.addEventListener('change', updateNameFilters);
    
    // Name search input listener
    elements.nameSearch.addEventListener('input', filterNameCheckboxes);

    // Existing checkbox and other listeners
    elements.resourcesList.addEventListener('change', function(event) {
        if (event.target.classList.contains("resourceCheckbox")) {
            const row = event.target.closest('tr');
            row.classList.toggle("highlighted", event.target.checked);
            
            // Update "Select All" state
            const allCheckboxes = document.querySelectorAll(".resourceCheckbox");
            const allChecked = Array.from(allCheckboxes).every(checkbox => checkbox.checked);
            const anyChecked = Array.from(allCheckboxes).some(checkbox => checkbox.checked);
            elements.selectAll.indeterminate = !allChecked && anyChecked;
            elements.selectAll.checked = allChecked;
        }
    });

    elements.labelSearch.addEventListener("keypress", function(event) {
        if (event.key === "Enter") handleSearch();
    });

    document.getElementById('logoutButton').addEventListener('click', async function() {
        const response = await fetch('/logout', { method: 'POST' });
        if (response.ok) window.location.href = '/';
        else alert('Logout failed');
    });

    elements.resourcesList.addEventListener('click', function(event) {
        if (event.target.classList.contains('toggle-labels')) {
            event.preventDefault();
            const link = event.target;
            const hiddenLabels = link.previousElementSibling;
            hiddenLabels.classList.toggle('hidden-labels');
            link.textContent = hiddenLabels.classList.contains('hidden-labels') ? 
                `(+${hiddenLabels.children.length} more)` : '(Show less)';
        }
    });
}

// Name filtering functions
async function updateNameFilters() {
    const namespace = elements.namespace.value.trim();
    const resourceType = elements.resourceType.value;
    if (!namespace) return clearNameCheckboxes();

    try {
        const names = await fetchResourceNames(namespace, resourceType);
        populateNameCheckboxes(names);
    } catch (error) {
        console.error("Error fetching names:", error);
        clearNameCheckboxes();
    }
}

async function fetchResourceNames(namespace, resourceType) {
    let fetchFunction;
    switch (resourceType) {
        case 'deployment': fetchFunction = fetchDeployments; break;
        case 'statefulset': fetchFunction = fetchStatefulSets; break;
        case 'pod': fetchFunction = fetchPods; break;
        default: return [];
    }
    const resources = await fetchFunction(namespace);
    return resources.map(resource => resource.name);
}

function populateNameCheckboxes(names) {
    elements.nameCheckboxes.innerHTML = '';
    names.forEach(name => {
        const div = document.createElement('div');
        div.className = 'form-check';
        div.innerHTML = `
            <input type="checkbox" class="form-check-input name-checkbox" value="${name}" id="${name}">
            <label class="form-check-label" for="${name}">${name}</label>
        `;
        elements.nameCheckboxes.appendChild(div);
    });
}

function filterNameCheckboxes(e) {
    const term = e.target.value.toLowerCase();
    document.querySelectorAll('.name-checkbox').forEach(checkbox => {
        const label = checkbox.nextElementSibling.textContent.toLowerCase();
        checkbox.closest('.form-check').style.display = label.includes(term) ? 'block' : 'none';
    });
}

function clearNameCheckboxes() {
    elements.nameCheckboxes.innerHTML = '';
}

function getSelectedNames() {
    return Array.from(document.querySelectorAll('.name-checkbox:checked'))
           .map(checkbox => checkbox.value);
}

// Modified Search Handling
async function handleSearch() {
    const namespace = elements.namespace.value.trim();
    const selectedNames = getSelectedNames();
    const labelSearchTerm = elements.labelSearch.value.trim();
    const isStrictSearch = elements.strict.checked;
    const resourceType = elements.resourceType.value;

    if (!namespace) {
        alert("Please select a namespace.");
        return;
    }

    try {
        let filteredResources = [];
        switch (resourceType) {
            case "deployment":
                filteredResources = await fetchAndFilterResources(namespace, selectedNames, labelSearchTerm, isStrictSearch, fetchDeployments, filterDeployments);
                break;
            case "statefulset":
                filteredResources = await fetchAndFilterResources(namespace, selectedNames, labelSearchTerm, isStrictSearch, fetchStatefulSets, filterStatefulSets);
                break;
            case "pod":
                filteredResources = await fetchAndFilterResources(namespace, selectedNames, labelSearchTerm, isStrictSearch, fetchPods, filterPods);
                break;
            default:
                alert("Invalid resource type selected.");
                return;
        }
        displayResources(filteredResources, resourceType);
    } catch (error) {
        console.error("Search error:", error);
        alert("Failed to fetch resources. Please try again.");
    }
}

// Modified Filter Functions
async function fetchAndFilterResources(namespace, selectedNames, labelSearchTerm, isStrictSearch, fetchFunction, filterFunction) {
    const data = await fetchFunction(namespace);
    return filterFunction(data, selectedNames, labelSearchTerm, isStrictSearch);
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

// Filter Deployments
function filterDeployments(deployments, searchTerm, labelSearchTerm, isStrictSearch) {
    return deployments.filter(deployment => {
        const matchesName = selectedNames.length === 0 || selectedNames.includes(deployment.name);
        const matchesLabel = evaluateCondition(
            Object.entries(deployment.labels || {}).map(([k, v]) => `${k}:${v}`).join(' '),
            labelSearchTerm,
            isStrictSearch
        );
        return matchesName && matchesLabel;
    });
}

function filterStatefulSets(statefulSets, selectedNames, labelSearchTerm, isStrictSearch) {
    return statefulSets.filter(ss => {
        const matchesName = selectedNames.length === 0 || selectedNames.includes(ss.name);
        const matchesLabel = evaluateCondition(
            Object.entries(ss.labels || {}).map(([k, v]) => `${k}:${v}`).join(' '),
            labelSearchTerm,
            isStrictSearch
        );
        return matchesName && matchesLabel;
    });
}

function filterPods(pods, selectedNames, labelSearchTerm, isStrictSearch) {
    return pods.filter(pod => {
        const matchesName = selectedNames.length === 0 || selectedNames.includes(pod.name);
        const matchesLabel = evaluateCondition(
            Object.entries(pod.labels || {}).map(([k, v]) => `${k}:${v}`).join(' '),
            labelSearchTerm,
            isStrictSearch
        );
        return matchesName && matchesLabel;
    });
}

// Evaluate Condition
function evaluateCondition(value, condition, isStrictSearch) {
    if (!condition) return true
    const conditions = condition.split(/\s+/);
    let result = true
    for (let i = 0; i < conditions.length; i++) {
        const cond = conditions[i].trim();
        if (cond === '&&') continue;
        if (cond === '||') {
            result = result || value.includes(conditions[i + 1]);
            i++;
        } else if (cond.startsWith('!')) {
            result = result && !value.includes(cond.slice(1));
        } else {
            if (isStrictSearch) {
                const regex = new RegExp(`\\b${cond}\\b`, 'i');
                result = result && regex.test(value);
            } else {
                result = result && value.toLowerCase().includes(cond.toLowerCase());
            }
        }
    }
    return result;
}

// Display Resources
function displayResources(resources, resourceType) {
    const resourcesList = elements.resourcesList;
    const tableHead = document.querySelector("#resourcesTable thead tr")
    resourcesList.innerHTML = "";
    tableHead.innerHTML = ""
    const headers = {
        deployment: ["Select", "Namespace", "Resource Type", "Name", "Labels", "Ready", "UpToDate", "Age"],
        statefulset: ["Select", "Namespace", "Resource Type", "Name", "Labels", "Ready", "Age"],
        pod: ["Select", "Namespace", "Resource Type", "Name", "Labels", "Ready", "Status", "Restarts", "Age"],
    };

    (headers[resourceType] || []).forEach(header => {
        const th = document.createElement("th");
        if (header === "Select") {
            th.innerHTML = '<input type="checkbox" id="selectAll">';
        } else {
            th.textContent = header;
        }
        tableHead.appendChild(th);
    });

    if (resources.length === 0) {
        const row = document.createElement("tr");
        row.innerHTML = `<td colspan="${headers[resourceType]?.length || 1}">No resources found.</td>`;
        resourcesList.appendChild(row);
        return;
    }

    resources.forEach(resource => {
        const row = document.createElement("tr");
        row.innerHTML = generateResourceRow(resource, resourceType);
        resourcesList.appendChild(row);
        applyStatusStyles(row, resource, resourceType); // Add this line
    });

    // Handle select all checkbox
    const selectAllCheckbox = document.getElementById("selectAll");
    document.getElementById("selectAll").addEventListener("change", function () {
        const checkboxes = document.querySelectorAll(".resourceCheckbox");
        const rows = document.querySelectorAll("#resourcesTable tbody tr");
        checkboxes.forEach((checkbox,index) => {
        checkbox.checked = this.checked;
        // Highlight or remove highlight on row
        if (checkbox.checked) {
            rows[index].classList.add("highlighted");
        } else {
            rows[index].classList.remove("highlighted");
        }
        });
    });
}

// Generate Resource Row
function generateResourceRow(resource, resourceType) {
    const rowData = {
        deployment: `
            <td><input type="checkbox" class="resourceCheckbox"></td>
            <td>${resource.namespace || "N/A"}</td>
            <td>${resource.resourceType}</td>
            <td>${resource.name || "N/A"}</td>
            <td>${formatLabels(resource.labels)}</td>
            <td>${resource.ready || "0"}</td>
            <td>${resource.up_to_date || "0"}</td>
            <td>${resource.age || "0"}</td>
        `,
        statefulset: `
            <td><input type="checkbox" class="resourceCheckbox"></td>
            <td>${resource.namespace || "N/A"}</td>
            <td>${resource.resourceType}</td>
            <td>${resource.name || "N/A"}</td>
            <td>${formatLabels(resource.labels)}</td>
            <td>${resource.ready || "0"}</td>
            <td>${resource.age || "0"}</td>
        `,
        pod: `
            <td><input type="checkbox" class="resourceCheckbox"></td>
            <td>${resource.namespace || "N/A"}</td>
            <td>${resource.resourceType}</td>
            <td>${resource.name || "N/A"}</td>
            <td>${formatLabels(resource.labels)}</td>
            <td>${resource.ready || "0"}</td>
            <td>${resource.status || "N/A"}</td>
            <td>${resource.restarts || "0"}</td>
            <td>${resource.age || "0"}</td>
        `
    };

    return rowData[resourceType] || "";
}

// Format Labels
function formatLabels(labels) {
    const labelEntries = Object.entries(labels || {});
    if (labelEntries.length === 0) return "No labels"
    // Show first 2 labels by default
    const visibleLabels = labelEntries.slice(0, 2);
    const hiddenLabels = labelEntries.slice(2)
    let html = visibleLabels.map(([key, value]) => 
        `<span class="label-cell">${key}: ${value}</span>`
    ).join('')
    // Add toggle if there are more labels
    if (hiddenLabels.length > 0) {
        html += `<span class="hidden-labels">${
            hiddenLabels.map(([key, value]) => 
                `<span class="label-cell">${key}: ${value}</span>`
            ).join('')
        }</span>
        <a class="toggle-labels" href="#">(+${hiddenLabels.length} more)</a>`;
    }

    return html;
}

// Perform Rollout Restart
async function performRolloutRestart() {
    const namespace = elements.namespace.value;
    if (!namespace) {
        alert("Please select a namespace first.");
        return;
    }
    const selectedResources = Array.from(document.querySelectorAll(".resourceCheckbox:checked"));
    if (selectedResources.length === 0) {
        alert("Please select at least one resource to restart.");
        return;
    }
    // Confirmation dialog
    const confirmationMessage = `Are you sure you want to restart ${selectedResources.length} selected resource(s)?`;
    const isConfirmed = confirm(confirmationMessage);
    if (!isConfirmed) {
        console.log("Rollout restart action canceled by the user.");
        return; // Exit if the user cancels the action
    }

    // Proceed with the rollout restart if the user confirms
    for (let checkbox of selectedResources) {
        const resourceName = checkbox.closest('tr').querySelector('td:nth-child(4)').textContent;
        const resourceType = checkbox.closest('tr').querySelector('td:nth-child(3)').textContent.toLowerCase() + 's'
        try {
            const response = await fetch(`/api/v1/${resourceType}/${namespace}/rollout/${resourceName}`, { method: 'POST' });
            if (!response.ok) {
                console.error(`Failed to restart ${resourceType}: ${resourceName}`);
                alert(`Failed to restart ${resourceType}: ${resourceName}`);
            }
        } catch (error) {
            console.error(`Error restarting ${resourceType} ${resourceName}:`, error);
            alert(`Error restarting ${resourceType} ${resourceName}: ${error.message}`);
        }
    }
    // Uncheck all checkboxes after successful rollout
    selectedResources.forEach(checkbox => {
        checkbox.checked = false;
        checkbox.closest('tr').classList.remove('highlighted');
    });
    // In performRolloutRestart function, after unchecking checkboxes:
    alert("Rollout restart triggered for selected resources.");
    // Immediately refresh and start polling
    await handleSearch();
    let isPolling = true;
    const pollInterval = setInterval(async () => {
        if (isPolling) {
            try {
                await handleSearch();
            } catch (error) {
                console.error("Polling error:", error);
            }
        }
    }, 5000); // Poll every 5 seconds
    // Stop polling after 2 minutes
    setTimeout(() => {
        isPolling = false;
        clearInterval(pollInterval);
    }, 120000);

}

// Apply styles to highlight updating resources
function applyStatusStyles(row, resource, resourceType) {
    const isUpdating = isResourceUpdating(resource, resourceType);
    if (isUpdating) {
        row.classList.add("updating-row");

        // Add spinner icon before the deployment name in the name cell
        const nameCell = row.querySelector("td:nth-child(4)");
        const spinner = document.createElement("i");
        spinner.className = "fas fa-spinner fa-spin spinner"; // Updated class for better styling
        nameCell.prepend(spinner); // Use prepend to place the spinner before the name
    }
}
// Determine if a resource is still updating
function isResourceUpdating(resource, resourceType) {
    switch (resourceType) {
        case "deployment":
            const [readyDeploy, totalDeploy] = resource.ready.split('/').map(Number);
            //const updated = parseInt(resource.updated, 10);
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
    setupEventListeners();
    displayUsername(username); // Display the username
}

document.addEventListener("DOMContentLoaded", initialize);