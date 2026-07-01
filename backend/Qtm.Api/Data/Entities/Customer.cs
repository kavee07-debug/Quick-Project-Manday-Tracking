namespace Qtm.Api.Data.Entities;

/// <summary>Customer master — owns projects. Maps to dbo.Customer.</summary>
public class Customer
{
    public int CustomerId { get; set; }
    public string Code { get; set; } = string.Empty;      // business key e.g. CUST001
    public string Name { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    public ICollection<Project> Projects { get; set; } = new List<Project>();
}
