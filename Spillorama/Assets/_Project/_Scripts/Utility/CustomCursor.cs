using UnityEngine;
using UnityEngine.UI;
using UnityEngine.EventSystems;
using System.Collections.Generic;

public class CustomCursor : MonoBehaviour
{
    public static CustomCursor Instance;

    public Texture2D cursorTexture;  // Assign your custom cursor texture in the inspector
    public Vector2 cursorHotspot = Vector2.zero;
    public Image customCursorImage;  // Assign your UI Image for the custom cursor in the inspector
    private RectTransform customCursorRectTransform;

    public Sprite Entercursor;
    public Sprite Exitcursor;

    private bool isCursorOutsideScreen;

    private void Awake()
    {
        Instance = this;
    }

    void Start()
    {
        // Hide the system cursor
        HideSystemCursor();

        // Get RectTransform of the custom cursor image
        customCursorRectTransform = customCursorImage.GetComponent<RectTransform>();
    }

    void Update()
    {
        // Ensure the system cursor is hidden
        HideSystemCursor();

        // Update the position of the custom cursor
        Vector2 cursorPosition = Input.mousePosition;

        // Check if the cursor is outside the screen bounds
        isCursorOutsideScreen = cursorPosition.x < 0 || cursorPosition.y < 0 ||
                                cursorPosition.x > Screen.width || cursorPosition.y > Screen.height;

        if (isCursorOutsideScreen)
        {
            customCursorImage.enabled = false;
        }
        else
        {
            customCursorImage.enabled = true;
            customCursorRectTransform.position = cursorPosition + cursorHotspot;
        }

        // Check for mouse click and trigger click events if necessary
        if (Input.GetMouseButtonDown(0) && !isCursorOutsideScreen)
        {
            HandleMouseClick(cursorPosition);
        }
    }

    void HideSystemCursor()
    {
        Cursor.visible = false;
        Cursor.lockState = CursorLockMode.None;
    }

    void HandleMouseClick(Vector2 cursorPosition)
    {
        // Check if the click is on a UI element
        PointerEventData pointerEventData = new PointerEventData(EventSystem.current)
        {
            position = cursorPosition
        };

        // Create a list to hold all the raycast results
        List<RaycastResult> raycastResults = new List<RaycastResult>();

        // Raycast using the Event System
        EventSystem.current.RaycastAll(pointerEventData, raycastResults);

        // Process the raycast results
        foreach (RaycastResult result in raycastResults)
        {
            // Check if the clicked UI element is a toggle button or other relevant UI element
            if (result.gameObject.GetComponent<Toggle>() != null /*|| result.gameObject.CompareTag("RelevantUIElement")*/)
            {
                // Execute pointer click event on the UI element
                ExecuteEvents.Execute(result.gameObject, pointerEventData, ExecuteEvents.pointerClickHandler);
                return;  // Return early to prevent further processing
            }
        }
    }

    void OnEnable()
    {
        // Ensure the custom cursor is visible when the script is enabled
        customCursorImage.enabled = true;
    }

    void OnDisable()
    {
        // Show the system cursor and hide the custom cursor when the script is disabled
        Cursor.visible = true;
        customCursorImage.enabled = false;
    }

    public void OnButtonCursorEnter()
    {
        Debug.Log("OnButtonCursorEnter");
        customCursorImage.sprite = Entercursor;
    }

    public void OnButtonCursorExit()
    {
        Debug.Log("OnButtonCursorExit");
        customCursorImage.sprite = Exitcursor;
    }
}
