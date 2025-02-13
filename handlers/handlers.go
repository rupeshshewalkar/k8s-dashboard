package handlers

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
)

type PodResource struct {
	Name         string            `json:"name"`
	Namespace    string            `json:"namespace"`
	Ready        string            `json:"ready"`
	Status       string            `json:"status"`
	Restarts     int32             `json:"restarts"`
	Age          string            `json:"age"`
	Labels       map[string]string `json:"labels"`
	ResourceType string            `json:"resourceType"`
}

type DeploymentResource struct {
	Name         string            `json:"name"`
	Namespace    string            `json:"namespace"`
	Ready        string            `json:"ready"`
	UpToDate     string            `json:"up_to_date"`
	Age          string            `json:"age"`
	Labels       map[string]string `json:"labels"`
	ResourceType string            `json:"resourceType"`
}

type StatefulSetResource struct {
	Name         string            `json:"name"`
	Namespace    string            `json:"namespace"`
	Ready        string            `json:"ready"`
	Age          string            `json:"age"`
	Labels       map[string]string `json:"labels"`
	ResourceType string            `json:"resourceType"`
}

// Add SessionData struct
type SessionData struct {
	KubeconfigContent string
	Username          string
	ExpiresAt         time.Time
}
type bodyLogWriter struct {
	gin.ResponseWriter
	body *bytes.Buffer
}

var sessions = make(map[string]SessionData)

func GetNamespaces(c *gin.Context) {
	//log.Printf("Received request for GetNamespaces from %s", c.Request.RemoteAddr)
	sessionToken, err := c.Cookie("sessionToken")
	session, exists := sessions[sessionToken]
	if err != nil || !exists || time.Now().After(session.ExpiresAt) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	clientset, err := validateKubeConfig(sessions[sessionToken].KubeconfigContent)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to validate kubeconfig: " + err.Error()})
		return
	}
	namespaces, err := clientset.CoreV1().Namespaces().List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		log.Printf("Response status: %d", http.StatusInternalServerError)
		return
	}

	var namespaceList []string
	for _, ns := range namespaces.Items {
		namespaceList = append(namespaceList, ns.Name)
	}

	c.JSON(http.StatusOK, namespaceList)
}

func GetDeployments(c *gin.Context) {
	sessionToken, err := c.Cookie("sessionToken")
	session, exists := sessions[sessionToken]
	if err != nil || !exists || time.Now().After(session.ExpiresAt) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	clientset, err := validateKubeConfig(sessions[sessionToken].KubeconfigContent)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to validate kubeconfig: " + err.Error()})
		return
	}

	namespace := c.Param("namespace")
	deployments, err := clientset.AppsV1().Deployments(namespace).List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		log.Printf("Response status: %d", http.StatusInternalServerError)
		return
	}

	var resourceList []DeploymentResource
	for _, d := range deployments.Items {
		totalReplicas := int(d.Status.Replicas)
		if d.Spec.Replicas != nil {
			totalReplicas = int(*d.Spec.Replicas) // Convert *int32 to int
		}

		readyReplicas := int(d.Status.ReadyReplicas)             // Pods that are fully ready
		availableReplicas := int(d.Status.AvailableReplicas)     // Pods that are running and available
		updatedReplicas := int(d.Status.UpdatedReplicas)         // Pods that have been updated to the latest version
		unavailableReplicas := int(d.Status.UnavailableReplicas) // Pods that are missing or failed

		// Default Status: ReadyReplicas / TotalReplicas
		statusMessage := fmt.Sprintf("%d/%d", readyReplicas, totalReplicas)

		// Check if rollout is in progress
		isUpdating := false
		for _, condition := range d.Status.Conditions {
			if condition.Type == appsv1.DeploymentProgressing && condition.Status == corev1.ConditionTrue {
				isUpdating = true
			}
		}

		// Show "Updating..." if rollout is ongoing
		if isUpdating && (updatedReplicas < totalReplicas || availableReplicas < totalReplicas || unavailableReplicas > 0) {
			statusMessage = fmt.Sprintf("%d/%d (Updating...)", availableReplicas, totalReplicas)
		}

		// Show "Unavailable..." if pods are missing
		if !isUpdating && unavailableReplicas > 0 {
			statusMessage = fmt.Sprintf("%d/%d (Unavailable...)", availableReplicas, totalReplicas)
		}

		// Mark as failed if there is a replica failure
		for _, condition := range d.Status.Conditions {
			if condition.Type == appsv1.DeploymentReplicaFailure && condition.Status == corev1.ConditionTrue {
				statusMessage = fmt.Sprintf("%d/%d (Failed)", availableReplicas, totalReplicas)
			}
		}

		// Update the status message to reflect the correct ready replicas
		if readyReplicas < totalReplicas {
			statusMessage = fmt.Sprintf("%d/%d (Not Ready)", readyReplicas, totalReplicas)
		}

		resource := DeploymentResource{
			Name:         d.Name,
			Namespace:    d.Namespace,
			Ready:        statusMessage,
			UpToDate:     fmt.Sprintf("%d", updatedReplicas),
			Age:          formatDuration(time.Since(d.CreationTimestamp.Time)),
			Labels:       d.Labels,
			ResourceType: "Deployment",
		}
		resourceList = append(resourceList, resource)
	}

	c.JSON(http.StatusOK, resourceList)
}

func RolloutRestart(c *gin.Context) {
	//log.Printf("Received request for RolloutRestart from %s", c.Request.RemoteAddr)
	if c.Request.Method != http.MethodPost {
		c.JSON(http.StatusMethodNotAllowed, gin.H{"error": "Method not allowed"})
		log.Printf("Response status: %d", http.StatusMethodNotAllowed)
		return
	}
	sessionToken, err := c.Cookie("sessionToken")
	session, exists := sessions[sessionToken]
	if err != nil || !exists || time.Now().After(session.ExpiresAt) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	clientset, err := validateKubeConfig(sessions[sessionToken].KubeconfigContent)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to validate kubeconfig: " + err.Error()})
		return
	}
	namespace := c.Param("namespace")
	deploymentName := c.Param("name")

	deployment, err := clientset.AppsV1().Deployments(namespace).Get(context.TODO(), deploymentName, metav1.GetOptions{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		log.Printf("Response status: %d", http.StatusInternalServerError)
		return
	}

	if deployment.Spec.Template.Annotations == nil {
		deployment.Spec.Template.Annotations = make(map[string]string)
	}
	deployment.Spec.Template.Annotations["kubectl.kubernetes.io/restartedAt"] = metav1.Now().String()

	_, err = clientset.AppsV1().Deployments(namespace).Update(context.TODO(), deployment, metav1.UpdateOptions{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		log.Printf("Response status: %d", http.StatusInternalServerError)
		return
	}

	c.Status(http.StatusOK)
}

// Helper function to format duration
func formatDuration(d time.Duration) string {
	days := d / (24 * time.Hour)
	d %= 24 * time.Hour
	hours := d / time.Hour
	d %= time.Hour
	minutes := d / time.Minute
	d %= time.Minute
	seconds := d / time.Second

	if days > 0 {
		return fmt.Sprintf("%dd", days)
	} else if hours > 0 {
		return fmt.Sprintf("%dh", hours)
	} else if minutes > 0 {
		return fmt.Sprintf("%dm", minutes)
	}
	return fmt.Sprintf("%ds", seconds)
}

func GetStatefulSets(c *gin.Context) {
	sessionToken, err := c.Cookie("sessionToken")
	session, exists := sessions[sessionToken]
	if err != nil || !exists || time.Now().After(session.ExpiresAt) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	clientset, err := validateKubeConfig(sessions[sessionToken].KubeconfigContent)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to validate kubeconfig: " + err.Error()})
		return
	}

	namespace := c.Param("namespace")
	statefulSets, err := clientset.AppsV1().StatefulSets(namespace).List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		log.Printf("Response status: %d", http.StatusInternalServerError)
		return
	}

	var resourceList []StatefulSetResource
	for _, ss := range statefulSets.Items {
		totalReplicas := 0
		if ss.Spec.Replicas != nil {
			totalReplicas = int(*ss.Spec.Replicas)
		}

		readyReplicas := int(ss.Status.ReadyReplicas) // Fully Ready Pods
		//currentReplicas := int(ss.Status.CurrentReplicas)     // Currently running pods
		updatedReplicas := int(ss.Status.UpdatedReplicas)     // Updated pods (new spec)
		availableReplicas := int(ss.Status.AvailableReplicas) // Pods that are running and available

		// Default status: ReadyReplicas / TotalReplicas
		statusMessage := fmt.Sprintf("%d/%d", readyReplicas, totalReplicas)

		// Identify rollout status
		isUpdating := false
		for _, condition := range ss.Status.Conditions {
			if condition.Type == appsv1.StatefulSetConditionType("Progressing") && condition.Status == corev1.ConditionTrue {
				isUpdating = true
			}
		}

		// Show "Updating..." if rollout is ongoing
		if isUpdating && (updatedReplicas < totalReplicas || availableReplicas < totalReplicas) {
			statusMessage = fmt.Sprintf("%d/%d (Updating...)", availableReplicas, totalReplicas)
		}

		// Detect Unavailable pods
		unavailableReplicas := totalReplicas - availableReplicas
		if unavailableReplicas > 0 {
			statusMessage = fmt.Sprintf("%d/%d (Unavailable...)", availableReplicas, totalReplicas)
		}

		// Mark as failed if pods are stuck
		for _, condition := range ss.Status.Conditions {
			if condition.Type == "ReplicaFailure" && condition.Status == corev1.ConditionTrue {
				statusMessage = fmt.Sprintf("%d/%d (Failed)", availableReplicas, totalReplicas)
			}
		}

		resource := StatefulSetResource{
			Name:         ss.Name,
			Namespace:    ss.Namespace,
			Ready:        statusMessage,
			Age:          formatDuration(time.Since(ss.CreationTimestamp.Time)),
			Labels:       ss.Labels,
			ResourceType: "StatefulSet",
		}
		resourceList = append(resourceList, resource)
	}

	c.JSON(http.StatusOK, resourceList)
}

func RolloutRestartStatefulSet(c *gin.Context) {
	//log.Printf("Received request for RolloutRestartStatefulSet from %s", c.Request.RemoteAddr)

	if c.Request.Method != http.MethodPost {
		c.JSON(http.StatusMethodNotAllowed, gin.H{"error": "Method not allowed"})
		log.Printf("Response status: %d", http.StatusMethodNotAllowed)
		return
	}
	sessionToken, err := c.Cookie("sessionToken")
	session, exists := sessions[sessionToken]
	if err != nil || !exists || time.Now().After(session.ExpiresAt) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	clientset, err := validateKubeConfig(sessions[sessionToken].KubeconfigContent)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to validate kubeconfig: " + err.Error()})
		return
	}
	namespace := c.Param("namespace")
	statefulSetName := c.Param("name")

	statefulSet, err := clientset.AppsV1().StatefulSets(namespace).Get(context.TODO(), statefulSetName, metav1.GetOptions{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		log.Printf("Response status: %d", http.StatusInternalServerError)
		return
	}

	if statefulSet.Spec.Template.Annotations == nil {
		statefulSet.Spec.Template.Annotations = make(map[string]string)
	}
	statefulSet.Spec.Template.Annotations["kubectl.kubernetes.io/restartedAt"] = metav1.Now().String()

	_, err = clientset.AppsV1().StatefulSets(namespace).Update(context.TODO(), statefulSet, metav1.UpdateOptions{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		log.Printf("Response status: %d", http.StatusInternalServerError)
		return
	}

	c.Status(http.StatusOK)
}

// GetPods fetches Pods in the specified namespace
func GetPods(c *gin.Context) {
	//log.Printf("Received request for GetPods from %s", c.Request.RemoteAddr)
	sessionToken, err := c.Cookie("sessionToken")
	session, exists := sessions[sessionToken]
	if err != nil || !exists || time.Now().After(session.ExpiresAt) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	clientset, err := validateKubeConfig(sessions[sessionToken].KubeconfigContent)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to validate kubeconfig: " + err.Error()})
		return
	}
	namespace := c.Param("namespace")
	podList, err := clientset.CoreV1().Pods(namespace).List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		log.Printf("Response status: %d", http.StatusInternalServerError)
		return
	}

	var resourceList []PodResource
	for _, pod := range podList.Items {
		// Get the status of each of the pods
		podStatus := pod.Status

		var containerRestarts int32
		var containerReady int
		var totalContainers int
		var containerReasonNotReady string

		// If a pod has multiple containers, get the status from all
		for i := range pod.Spec.Containers {
			if !podStatus.ContainerStatuses[i].Ready {
				if waiting := podStatus.ContainerStatuses[i].State.Waiting; waiting != nil {
					containerReasonNotReady += waiting.Reason + " "
				}
				if terminated := podStatus.ContainerStatuses[i].State.Terminated; terminated != nil {
					containerReasonNotReady += terminated.Reason + " "
				}
			}

			containerRestarts += podStatus.ContainerStatuses[i].RestartCount
			if podStatus.ContainerStatuses[i].Ready {
				containerReady++
			}
			totalContainers++
		}

		// Get the values from the pod status
		name := pod.GetName()
		ready := fmt.Sprintf("%v/%v", containerReady, totalContainers)

		var actualStatus string
		if len(containerReasonNotReady) > 0 {
			actualStatus = strings.TrimSpace(containerReasonNotReady) // Trim any trailing spaces
		} else {
			actualStatus = string(podStatus.Phase)
		}

		// Append this to the resource list
		resource := PodResource{
			Name:         name,
			Namespace:    pod.Namespace,
			Ready:        ready,
			Status:       actualStatus,
			Restarts:     containerRestarts,
			Labels:       pod.Labels,
			Age:          formatDuration(time.Since(pod.CreationTimestamp.Time)),
			ResourceType: "Pod",
		}
		resourceList = append(resourceList, resource)
	}

	c.JSON(http.StatusOK, resourceList)
}

// RolloutRestartPod restarts the specified Pod
func RolloutRestartPod(c *gin.Context) {
	//"Received request for RolloutRestartPod from %s", c.Request.RemoteAddr)

	if c.Request.Method != http.MethodPost {
		c.JSON(http.StatusMethodNotAllowed, gin.H{"error": "Method not allowed"})
		log.Printf("Response status: %d", http.StatusMethodNotAllowed)
		return
	}
	sessionToken, err := c.Cookie("sessionToken")
	session, exists := sessions[sessionToken]
	if err != nil || !exists || time.Now().After(session.ExpiresAt) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	clientset, err := validateKubeConfig(sessions[sessionToken].KubeconfigContent)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to validate kubeconfig: " + err.Error()})
		return
	}
	namespace := c.Param("namespace")
	podName := c.Param("name")

	// Delete the Pod to trigger a restart
	err = clientset.CoreV1().Pods(namespace).Delete(context.TODO(), podName, metav1.DeleteOptions{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		log.Printf("Response status: %d", http.StatusInternalServerError)
		return
	}

	c.Status(http.StatusOK)
}

func validateKubeConfig(kubeconfigContent string) (*kubernetes.Clientset, error) {
	clientConfig, err := clientcmd.NewClientConfigFromBytes([]byte(kubeconfigContent))
	if err != nil {
		return nil, fmt.Errorf("error creating client config: %v", err)
	}
	restConfig, err := clientConfig.ClientConfig()
	if err != nil {
		return nil, fmt.Errorf("error getting rest config: %v", err)
	}
	return kubernetes.NewForConfig(restConfig)
}

func UploadKubeConfig(c *gin.Context) {
	file, err := c.FormFile("kubeconfig")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to get file"})
		return
	}

	uploadedFile, err := file.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to open uploaded file"})
		return
	}
	defer uploadedFile.Close()

	kubeconfigBytes, err := io.ReadAll(uploadedFile)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read kubeconfig content"})
		return
	}
	kubeconfigContent := string(kubeconfigBytes)

	clientset, err := validateKubeConfig(kubeconfigContent)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid kubeconfig: " + err.Error()})
		return
	}

	// Extract username from kubeconfig
	kubeconfig, err := clientcmd.Load(kubeconfigBytes)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load kubeconfig: " + err.Error()})
		return
	}
	currentContext := kubeconfig.Contexts[kubeconfig.CurrentContext]
	username := currentContext.AuthInfo

	// Example interaction: List namespaces
	namespaces, err := clientset.CoreV1().Namespaces().List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to interact with cluster: " + err.Error()})
		return
	}
	// Invalidate any existing session for this client before creating a new one
	if existingToken, err := c.Cookie("sessionToken"); err == nil {
		// Delete old session if it exists
		delete(sessions, existingToken)
	}
	// Create a session token and store the kubeconfig content
	sessionToken := fmt.Sprintf("%d", time.Now().UnixNano())
	sessions[sessionToken] = SessionData{
		KubeconfigContent: kubeconfigContent,
		Username:          username,
		ExpiresAt:         time.Now().Add(1 * time.Hour),
	}
	// Set the session token in a cookie
	c.SetCookie("sessionToken", sessionToken, 3600, "/", "", false, true)

	c.JSON(http.StatusOK, gin.H{
		"message":    "Kubeconfig validated successfully",
		"namespaces": namespaces,
		"user":       username,
	})
}

func AuthCheck(c *gin.Context) {
	//log.Printf("Received request for Authentication check from %s", c.Request.RemoteAddr)
	sessionToken, err := c.Cookie("sessionToken")
	session, exists := sessions[sessionToken]
	if err != nil || !exists || time.Now().After(session.ExpiresAt) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": sessions[sessionToken].Username})
}

// Add this function to handle logout
func Logout(c *gin.Context) {
	sessionToken, _ := c.Cookie("sessionToken")
	delete(sessions, sessionToken)
	c.SetCookie("sessionToken", "", -1, "/", "", false, true)
	c.JSON(http.StatusOK, gin.H{"message": "Logged out successfully"})
}
func (w bodyLogWriter) Write(b []byte) (int, error) {
	w.body.Write(b)
	return w.ResponseWriter.Write(b)
}

// handlers.go
func LoggingMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Capture details before processing
		start := time.Now()
		clientIP := c.ClientIP()
		path := c.Request.URL.Path
		method := c.Request.Method

		// Capture request body
		var requestBody bytes.Buffer
		if c.Request.Body != nil {
			bodyBytes, _ := io.ReadAll(c.Request.Body)
			c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
			requestBody.Write(bodyBytes)
		}

		// Process request first
		c.Next()

		// Capture response details
		status := c.Writer.Status()
		username := "Unauthorized"
		if sessionToken, err := c.Cookie("sessionToken"); err == nil {
			if session, exists := sessions[sessionToken]; exists {
				username = session.Username
			}
		}

		// Format log entry
		logEntry := fmt.Sprintf(
			"[%s] %s %s %s %d %s\n",
			start.Format(time.RFC3339),
			username,
			clientIP,
			fmt.Sprintf("%s %s", method, path),
			status,
			//requestBody.String(),
			c.Request.UserAgent(),
		)

		// Write to log file
		logFile, err := os.OpenFile("logs/access.log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil {
			log.Printf("Failed to write log: %v", err)
			return
		}
		defer logFile.Close()

		if _, err := logFile.WriteString(logEntry); err != nil {
			log.Printf("Failed to write log: %v", err)
		}
	}
}

// Add this function for periodic session cleanup
func CleanupSessions() {
	for {
		time.Sleep(5 * time.Minute) // Runs every 5 minutes
		for token, session := range sessions {
			if time.Now().After(session.ExpiresAt) {
				delete(sessions, token)
			}
		}
	}
}
